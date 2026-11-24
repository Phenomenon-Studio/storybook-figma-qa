// Figma colour variables through the real CLI: named ids hold the story to the kit token `tokenName` gives (the
// cascade, not the value), unnamed ids fall back to value matching as a guess with one run warning, and
// `figma-qa variables` names new ids from the Plugin API script's output. Tests that unname an id restore the
// committed `variables.json` after.
import type { Fixture, StoryResult } from './cli.ts';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixtureDir, FIXTURES, HOST_WARNING, report, runCli, runIn, storyResult } from './cli.ts';

const CATALOG = 'figma-qa/__refs__/variables.json';
/** Where a test saves the script output it merges. */
const PASTE = 'node_modules/.cache/figma-qa-variables.json';
const UNNAMED_WARNING =
    '1 Figma variable is unnamed: rows bound to them are matched by value (a guess). Name them via `figma-qa variables`.';

type Issue = { property: string; expected: { note?: string }; actual: { note?: string }; tolerance: string };
type Cell = { status: string; variant: { name: string }; spec: { mismatches: Issue[] } };

function cell(result: StoryResult, name: string): Cell | undefined {
    return result.blocks
        .flatMap((block) => {
            return block.cells as unknown as Cell[];
        })
        .find((each) => {
            return each.variant.name === name;
        });
}

type Stories = { stories: { storyId: string; results: string | null }[] };

async function storyOf(fixture: Fixture, summary: Stories, id: string): Promise<StoryResult> {
    const story = summary.stories.find((each) => {
        return each.storyId === id;
    });

    return await storyResult(fixture, story?.results ?? null);
}

describe.each(FIXTURES)('figma variables in fixtures/%s', (fixture) => {
    const root = fixtureDir(fixture);
    const catalogFile = path.join(root, CATALOG);
    let committed: string;

    async function catalog(): Promise<{ variables: Record<string, { name: string }> }> {
        return JSON.parse(await readFile(catalogFile, 'utf8'));
    }

    /** The committed catalogue without `ids`: as if a sync had found them after the last naming. */
    async function unname(...ids: string[]) {
        const next = JSON.parse(committed);
        for (const id of ids) {
            delete next.variables[id];
        }
        await writeFile(catalogFile, `${JSON.stringify(next, null, 4)}\n`);
    }

    beforeEach(async () => {
        committed = await readFile(catalogFile, 'utf8');
    });

    afterEach(async () => {
        await writeFile(catalogFile, committed);
        await rm(path.join(root, PASTE), { force: true });
    });

    it('fails a right value painted with the wrong token, and passes the token the variable names', async () => {
        const { code, stderr, summary } = await report(fixture, ['Swatch.figma', 'SwatchToken.figma']);

        expect(code, stderr).toBe(1);
        expect(summary.warnings).toEqual([HOST_WARNING]);
        // `Swatch` paints Brand with `--color-brand`, the token `Brand` names.
        const named = await storyOf(fixture, summary, 'swatch-figma--matrix');
        expect(cell(named, 'Size=Small, Tone=Brand')?.status).toBe('pass');
        // `SwatchToken` paints it with `--color-primary`: the same value, so only the token check sees it.
        const wrong = cell(await storyOf(fixture, summary, 'swatch-figma-token--matrix'), 'Size=Small, Tone=Brand');
        expect(wrong?.status).toBe('fail');
        expect(wrong?.spec.mismatches).toEqual([
            expect.objectContaining({
                property: 'Background',
                expected: expect.objectContaining({ text: 'hsl(228 69% 54.5%)', note: 'var Brand = --color-brand' }),
                actual: expect.objectContaining({ text: 'hsl(228 69% 54.5%)', note: '= --color-primary' }),
                tolerance: 'painted with --color-brand',
            }),
        ]);
    });

    it('matches an unnamed variable by value, labelled a guess, with one warning and the same exit code', async () => {
        await unname('1:2');

        const { code, stderr, summary } = await report(fixture, ['Swatch.figma']);

        expect(code, stderr).toBe(0);
        expect(summary.warnings).toEqual([HOST_WARNING, UNNAMED_WARNING]);
        const neutral = cell(await storyOf(fixture, summary, 'swatch-figma--matrix'), 'Size=Small, Tone=Neutral');
        expect(neutral?.status).toBe('approved');
        expect(neutral?.spec.mismatches[0]?.expected.note).toBe(
            'var 1:2 (unnamed) · guess ≈ --color-neutral (Δ39)'
        );
    });

    it('prints the naming script for unnamed ids only, then nothing once every id is named', async () => {
        await unname('1:2');

        const unnamed = await runCli(fixture, ['variables']);

        expect(unnamed.code, unnamed.stderr).toBe(0);
        expect(unnamed.stdout).toContain(
            '// Figma file FIXTUREKIT: 1 unnamed. Run with use_figma (fileKey "FIXTUREKIT")'
        );
        expect(unnamed.stdout).toContain('const ids = ["1:2"];');
        expect(unnamed.stdout).toContain("figma.variables.getVariableByIdAsync('VariableID:' + id)");
        expect(unnamed.stdout).toContain('return { variables, missing };');

        await writeFile(catalogFile, committed);
        const named = await runCli(fixture, ['variables']);

        expect(named.code, named.stderr).toBe(0);
        expect(named.stdout).toBe('');
        expect(named.stderr).toContain('every bound variable is named');
    });

    it('merges pasted script output, keeps existing names, and is idempotent', async () => {
        await unname('1:2');
        // The script's output, with a stale name for an id the catalogue already has: committed names win.
        const output = JSON.stringify({
            variables: {
                '1:1': { collection: 'Tones', type: 'COLOR', name: 'Renamed/Brand' },
                '1:2': { collection: 'Tones', type: 'COLOR', name: 'Tone/Neutral' },
            },
            missing: ['9:9'],
        });
        const input = path.join(root, PASTE);
        await writeFile(input, output);
        const paste = ['sh', '-c', `pnpm exec figma-qa variables - < '${input}'`];

        const first = await runIn(root, paste);

        expect(first.code, first.stderr).toBe(0);
        expect(first.stdout).toContain('named 1: 1:2; every bound variable is named.');
        expect(first.stdout).toContain('not found in the file the script ran in: 9:9.');
        expect((await catalog()).variables).toEqual(JSON.parse(committed).variables);
        const merged = await readFile(catalogFile, 'utf8');

        const again = await runCli(fixture, ['variables', input]);

        expect(again.code, again.stderr).toBe(0);
        expect(again.stdout).toContain('nothing new to name');
        expect(await readFile(catalogFile, 'utf8')).toBe(merged);
    });

    it('refuses output that is not the naming script\'s, leaving the catalogue as it was', async () => {
        await unname('1:2');
        const before = await readFile(catalogFile, 'utf8');
        const input = path.join(root, PASTE);
        await writeFile(input, JSON.stringify({ variables: { '1:2': { name: 'Tone/Neutral' } } }));

        const result = await runCli(fixture, ['variables', input]);

        expect(result.code).toBe(2);
        expect(result.stderr).toContain('variable "1:2": expected { collection, type, name } from the script');
        expect(await readFile(catalogFile, 'utf8')).toBe(before);
    });
});
