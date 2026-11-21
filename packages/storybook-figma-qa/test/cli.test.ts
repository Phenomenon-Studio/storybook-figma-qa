// Seam 1: the real `figma-qa` binary, run the way a consumer runs it, inside each fixture project.
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const FIXTURES = ['sb10', 'sb11'] as const;

type Fixture = (typeof FIXTURES)[number];

function fixtureDir(fixture: Fixture) {
    return fileURLToPath(new URL(`../../../fixtures/${fixture}`, import.meta.url));
}

/** `execFile` rejects on non-zero exit with the exit code and output on the error. */
function isExitError(error: unknown): error is Error & { code: number; stdout: string; stderr: string } {
    return error instanceof Error && typeof (error as { code?: unknown }).code === 'number';
}

async function runCli(fixture: Fixture, args: string[]) {
    try {
        const { stdout, stderr } = await execFileAsync('pnpm', ['exec', 'figma-qa', ...args], {
            cwd: fixtureDir(fixture),
        });

        return { code: 0, stdout, stderr };
    } catch (error) {
        if (!isExitError(error)) {
            throw error;
        }

        return { code: error.code, stdout: error.stdout, stderr: error.stderr };
    }
}

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

type Cells = { pass: number; fail: number; approved: number; missing: number };
type Summary = {
    exitCode: number;
    cells: Cells;
    stories: { storyId: string; verdict: string; cells: Cells; error: string | null; results: string | null }[];
    errors: string[];
};
type StoryResult = {
    error: string | null;
    blocks: { cells: { variant: { name: string }; status: string; approval: string | null }[] }[];
};

async function report(fixture: Fixture, filter: string) {
    const result = await runCli(fixture, ['report', filter, '--json']);
    // stdout holds only the summary: anything else there fails the parse.
    const summary = JSON.parse(result.stdout) as Summary;

    return { ...result, summary };
}

async function storyResult(fixture: Fixture, file: string | null): Promise<StoryResult> {
    expect(file).not.toBeNull();

    return JSON.parse(await readFile(path.join(fixtureDir(fixture), file ?? ''), 'utf8')) as StoryResult;
}

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
        const { code, stderr, summary } = await report(fixture, 'Swatch.figma');

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

    it('exits 1 when a cell differs from Figma', async () => {
        const { code, stderr, summary } = await report(fixture, 'SwatchDrift.figma');

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
        const { code, stderr, summary } = await report(fixture, 'Misconfigured.figma');

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
