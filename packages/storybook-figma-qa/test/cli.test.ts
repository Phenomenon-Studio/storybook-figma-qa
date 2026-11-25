// Seam 1: the real `figma-qa` binary, run the way a consumer runs it, inside each fixture project.
import type { StoryResult } from './cli.ts';
import { readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { doctor, fixtureDir, FIXTURES, report, runCli, storyResult } from './cli.ts';

describe.each(FIXTURES)('figma-qa in fixtures/%s', (fixture) => {
    it('doctor exits 0', async () => {
        const result = await doctor(fixture);

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

    // Ticket 09: each ref is flattened once per (ref hash, backdrop) and kept under the local cache, so an unchanged
    // ref skips the flatten on the next run. Per-cell check time is reported, never asserted against a budget.
    it('reports per-cell check time and reuses flattened refs across runs', async () => {
        const cache = path.join(fixtureDir(fixture), 'node_modules/.cache/figma-qa/flat-v1');
        await rm(cache, { recursive: true, force: true });

        const first = await report(fixture, ['Swatch.figma']);

        expect(first.code, first.stderr).toBe(0);
        expect(first.summary.cellMs).toBeGreaterThan(0);
        const files = await readdir(cache);
        // One per captured cell: 2 pass + 2 approved, all on the same backdrop.
        expect(files).toHaveLength(4);
        const written = await Promise.all(
            files.map(async (file) => {
                return (await stat(path.join(cache, file))).mtimeMs;
            })
        );

        const second = await report(fixture, ['Swatch.figma']);

        expect(second.code, second.stderr).toBe(0);
        expect(second.summary.cells).toEqual(first.summary.cells);
        expect(await readdir(cache)).toEqual(files);
        const reread = await Promise.all(
            files.map(async (file) => {
                return (await stat(path.join(cache, file))).mtimeMs;
            })
        );
        expect(reread).toEqual(written);
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

    it('prints what differs from Figma under each failing cell, plain when stdout is not a terminal', async () => {
        const { code, stdout } = await runCli(fixture, ['report', 'swatch-figma-triage', '--host-browser', '--no-open']);

        expect(code).toBe(1);
        // stdout is a pipe here: the kit's lines carry no escape codes for agents, pipes and CI logs. (Vitest's own run
        // log above them colours itself.)
        const kitLines = stdout.indexOf('FAIL  Swatch › Matrix');
        expect(kitLines).toBeGreaterThan(-1);
        expect(stdout.slice(kitLines)).not.toContain('\u001b[');
        const under = (header: string) => {
            const lines = stdout.slice(stdout.indexOf(header)).split('\n').slice(1);
            const end = lines.findIndex((line) => {
                return !line.startsWith('        ');
            });

            return lines.slice(0, end).join('\n');
        };
        // token: Figma's token and the story's, on their own lines.
        const token = under('✗ swatch · Size=Small, Tone=Brand [token]');
        expect(token).toMatch(/^ {8}Component › Background \(.+\)$/m);
        expect(token).toMatch(/^ {8}- figma {2}\S.* {2}--color-brand$/m);
        expect(token).toMatch(/^ {8}\+ story {2}\S.* {2}--color-neutral {2}delta /m);
        expect(token).toMatch(
            /^ {8}pixels: [\d.]+% differ \(max 5%\) → figma-qa\/\.results\/swatch-figma-triage--matrix-[\d-]+-diff\.png$/m
        );
        // value: the delta on the story's line.
        const value = under('✗ swatch · Size=Large, Tone=Brand [value]');
        expect(value).toContain('        Component › Width (±1px)\n        - figma  40px\n        + story  24px  delta −16px\n');
        // harness: the image error in place of a share.
        const harness = under('✗ swatch · Size=Small, Tone=Brand [harness]');
        expect(harness).toContain('        pixels: not measured: Capture blocked: div.fixture-blocker covers the cell.');
    });
});
