// Seam 1: the real `figma-qa` binary, run the way a consumer runs it, inside each fixture project.
import type { StoryResult } from './cli.ts';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixtureDir, FIXTURES, report, runCli, storyResult } from './cli.ts';

describe.each(FIXTURES)('figma-qa in fixtures/%s', (fixture) => {
    it('doctor exits 0', async () => {
        const result = await runCli(fixture, ['doctor']);

        expect(result.code, result.stderr).toBe(0);
        expect(result.stdout).toContain('doctor');
    });

    it('unknown command exits 2 with usage', async () => {
        const result = await runCli(fixture, ['nope']);

        expect(result.code).toBe(2);
        expect(result.stderr).toContain('Usage: figma-qa');
    });
});

function statuses(result: StoryResult): Record<string, string> {
    return Object.fromEntries(
        result.blocks.flatMap((block) => {
            return block.cells.map((cell) => {
                return [cell.variant.name, cell.status];
            });
        })
    );
}

// Offline from the fixture's committed refs: no token, no network.
describe.each(FIXTURES)('figma-qa report in fixtures/%s', (fixture) => {
    it('exits 0 when every cell passes, is approved or has no code equivalent', async () => {
        const { code, stderr, summary } = await report(fixture, ['Swatch.figma']);

        expect(code, stderr).toBe(0);
        expect(summary.exitCode).toBe(0);
        expect(summary.cells).toEqual({ pass: 2, fail: 0, approved: 2, missing: 2 });
        expect(summary.stories).toHaveLength(1);
        expect(summary.stories[0]?.verdict).toBe('pass');
        const result = await storyResult(fixture, summary.stories[0]?.results ?? null);
        expect(result.error).toBeNull();
        expect(statuses(result)).toEqual({
            'Size=Small, Tone=Brand': 'pass',
            'Size=Small, Tone=Neutral': 'approved',
            'Size=Small, Tone=Danger': 'missing',
            'Size=Large, Tone=Brand': 'pass',
            'Size=Large, Tone=Neutral': 'approved',
            'Size=Large, Tone=Danger': 'missing',
        });
        const approved = result.blocks[0]?.cells.find((cell) => {
            return cell.status === 'approved';
        });
        expect(approved?.approval).toContain('WCAG 1.4.11');
    });

    // A fresh install (as on CI) has no Storybook cache, so Storybook prints its telemetry
    // notice straight to process.stdout during the run.
    it('keeps --json stdout to the summary on the first run after install', async () => {
        await rm(path.join(fixtureDir(fixture), 'node_modules/.cache/storybook'), { recursive: true, force: true });

        const { code, stderr, summary } = await report(fixture, ['Swatch.figma']);

        expect(code, stderr).toBe(0);
        expect(summary.exitCode).toBe(0);
    });

    it('exits 1 when a cell differs from Figma', async () => {
        const { code, stderr, summary } = await report(fixture, ['SwatchDrift.figma']);

        expect(code, stderr).toBe(1);
        expect(summary.cells).toEqual({ pass: 2, fail: 2, approved: 0, missing: 2 });
        expect(summary.stories[0]?.verdict).toBe('fail');
        const result = await storyResult(fixture, summary.stories[0]?.results ?? null);
        expect(statuses(result)).toMatchObject({
            'Size=Small, Tone=Neutral': 'fail',
            'Size=Large, Tone=Neutral': 'fail',
        });
    });

    it('exits 2 for a figma-tagged story without a figma design entry or matrix', async () => {
        const { code, stderr, summary } = await report(fixture, ['Misconfigured.figma']);

        expect(code, stderr).toBe(2);
        const errors = Object.fromEntries(
            summary.stories.map((story) => {
                return [story.storyId, story.error];
            })
        );
        expect(errors).toEqual({
            'swatch-figma-misconfigured--no-design-entry': expect.stringContaining('no named `figma` entry'),
            'swatch-figma-misconfigured--no-matrix': expect.stringContaining('no `parameters.figmaMatrix.blocks`'),
        });
        for (const story of summary.stories) {
            expect(story.verdict).toBe('error');
            expect((await storyResult(fixture, story.results)).error).toBe(story.error);
        }
    });
});
