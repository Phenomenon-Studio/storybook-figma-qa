// The results model a run leaves behind: the diff map computed in Node and persisted per cell, the run summary, and
// the self-contained HTML report rendered from both. Runs the real CLI in each fixture.
import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FigmaStoryResult } from '../src/figma/types.ts';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { REPORT_DIR, RUN_FILE } from '../src/figma/types.ts';
import { FIXTURES, fixtureDir, report } from './cli.ts';

async function readJsonFile<T>(fixture: (typeof FIXTURES)[number], file: string): Promise<T> {
    return JSON.parse(await readFile(path.join(fixtureDir(fixture), file), 'utf8')) as T;
}

/** `data-verdict` of every story section in the report, keyed by story id. */
function reportVerdicts(html: string): Record<string, string> {
    const verdicts: Record<string, string> = {};
    for (const match of html.matchAll(/data-story-id="([^"]+)"[^>]*data-verdict="([^"]+)"/g)) {
        verdicts[match[1] ?? ''] = match[2] ?? '';
    }

    return verdicts;
}

describe.each(FIXTURES)('results model in fixtures/%s', (fixture) => {
    it('persists the diff map per cell and renders the same verdicts in the HTML report', async () => {
        const { code, stderr, summary } = await report(fixture, ['Swatch.figma', 'SwatchDrift.figma']);

        expect(code, stderr).toBe(1);
        const root = fixtureDir(fixture);

        // The run summary is written next to the story results, as printed.
        expect(await readJsonFile(fixture, RUN_FILE)).toEqual(summary);

        const drift = summary.stories.find((story) => {
            return story.verdict === 'fail';
        });
        const cells = (await readJsonFile<FigmaStoryResult>(fixture, drift?.results ?? '')).blocks[0]
            ?.cells;
        const failing = cells?.find((cell) => {
            return cell.status === 'fail';
        });
        const passing = cells?.find((cell) => {
            return cell.status === 'pass';
        });
        // Neutral's fill differs: same shape, other colour.
        expect(failing?.image.classes?.colour).toBeGreaterThan(0);
        expect(failing?.image.pair).toEqual({ figma: expect.stringMatching(/^#/), story: expect.stringMatching(/^#/) });
        expect(failing?.image.blob?.area).toBeGreaterThan(0);
        expect(failing?.image.blob?.element).toEqual(expect.any(String));
        expect(passing?.image.classes).toEqual(expect.any(Object));
        // The diff image is the classified map, the size of the screenshot.
        const actual = PNG.sync.read(await readFile(path.join(root, failing?.files.actual ?? '')));
        const map = PNG.sync.read(await readFile(path.join(root, failing?.files.diff ?? '')));
        expect([map.width, map.height]).toEqual([actual.width, actual.height]);

        const html = await readFile(path.join(root, REPORT_DIR, 'index.html'), 'utf8');
        expect(reportVerdicts(html)).toEqual(
            Object.fromEntries(
                summary.stories.map((story) => {
                    return [story.storyId, story.verdict];
                })
            )
        );
        // Self-contained: every image the report shows is inside the report directory (uploaded as one artifact).
        const sources = [...html.matchAll(/<img[^>]* src="([^"]+)"/g)].map((match) => {
            return match[1] ?? '';
        });
        expect(sources.length).toBeGreaterThan(0);
        for (const source of sources) {
            expect(source).not.toMatch(/^(\/|\.\.|[a-z]+:)/);
            await access(path.join(root, REPORT_DIR, decodeURIComponent(source)));
        }
    });

    it('reports a harness error as not a design verdict', async () => {
        const { code, summary } = await report(fixture, ['Misconfigured.figma']);

        expect(code).toBe(2);
        const html = await readFile(path.join(fixtureDir(fixture), REPORT_DIR, 'index.html'), 'utf8');
        expect(Object.values(reportVerdicts(html))).toEqual(['error', 'error']);
        expect(html).toContain('not a design verdict');
        // Escaped in the markup: compare up to the first quote.
        expect(html).toContain(summary.stories[0]?.error?.split('"')[0]);
    });

    it('replaces the previous run when setup fails before Vitest starts', async () => {
        await report(fixture, ['Swatch.figma']);
        const { code, summary } = await report(fixture, ['Swatch.figma', '--refresh']);

        expect(code).toBe(2);
        const root = fixtureDir(fixture);
        expect(await readJsonFile(fixture, RUN_FILE)).toEqual(summary);
        await expect(stat(path.join(root, 'figma-qa/.results/results'))).rejects.toThrow();
        const html = await readFile(path.join(root, REPORT_DIR, 'index.html'), 'utf8');
        expect(html).toContain('needs FIGMA_TOKEN');
        expect(html).not.toContain('data-story-id');
    });
});
