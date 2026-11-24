// Seam 1: the real `figma-qa` binary, run the way a consumer runs it, inside each fixture project.
import type { StoryResult } from './cli.ts';
import { readFile, rm } from 'node:fs/promises';
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

    it('triages each failing cell and prints a paste-ready approval, rewriting no story', async () => {
        const file = path.join(fixtureDir(fixture), 'src/SwatchTriage.figma.stories.tsx');
        const source = await readFile(file, 'utf8');

        const { code, stderr, summary } = await report(fixture, ['SwatchTriage.figma']);

        expect(code, stderr).toBe(1);
        const triage = Object.fromEntries(
            summary.stories.map((story) => {
                return [
                    story.storyId,
                    Object.fromEntries(
                        story.failing.map((cell) => {
                            return [cell.variant, cell.triage];
                        })
                    ),
                ];
            })
        );
        expect(triage).toEqual({
            'swatch-figma-triage--matrix': {
                'Size=Small, Tone=Brand': 'token',
                'Size=Large, Tone=Brand': 'value',
                'Size=Small, Tone=Neutral': null,
                'Size=Large, Tone=Neutral': null,
            },
            'swatch-figma-triage--blocked': {
                'Size=Small, Tone=Brand': 'harness',
                'Size=Large, Tone=Brand': 'harness',
                'Size=Small, Tone=Neutral': 'harness',
                'Size=Large, Tone=Neutral': 'harness',
            },
        });
        for (const story of summary.stories) {
            // The results JSON carries the same category the summary reports.
            const result = await storyResult(fixture, story.results);
            const cells = result.blocks.flatMap((block) => {
                return block.cells;
            });
            for (const failing of story.failing) {
                const cell = cells.find((candidate) => {
                    return candidate.variant.name === failing.variant;
                });
                expect(cell?.triage).toBe(failing.triage);
                if (failing.triage === 'harness') {
                    // An unmeasured cell can't be approved: nothing to paste.
                    expect(failing.approved).toBeNull();
                    continue;
                }
                // Pasted into the block's `approved`, the entry covers exactly this variant. Evaluated as the story
                // file would: the kit's own printed literal, so it must parse as written.
                const entry = new Function(`return ${failing.approved}`)() as { when: unknown; reason: string };
                expect(failing.block).toBe('swatch');
                expect(entry.when).toEqual(
                    Object.fromEntries(
                        Object.entries(cell?.variant.props ?? {}).map(([name, option]) => {
                            return [name, [option]];
                        })
                    )
                );
                expect(entry.reason).toMatch(/^TODO: /);
            }
        }
        expect(await readFile(file, 'utf8')).toBe(source);
    });

    it('prints the approval entry under each failing cell', async () => {
        const { code, stdout } = await runCli(fixture, [
            'report',
            'swatch-figma-triage--matrix',
            '--host-browser',
            '--no-open',
        ]);

        expect(code).toBe(1);
        expect(stdout).toContain('✗ swatch · Size=Small, Tone=Brand [token]\n');
        expect(stdout).toContain('✗ swatch · Size=Small, Tone=Neutral\n');
        expect(stdout).toContain(
            "approved: { when: { Size: ['Large'], Tone: ['Brand'] }, reason: 'TODO: why this deviation is deliberate (WCAG criterion or decision)' },"
        );
    });
});
