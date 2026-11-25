// Seam 1: `figma-qa migrate` with the kit's real step list (empty: refs format 1), and `report` refusing refs in
// another format. The runner with steps of its own is migrate.test.ts's subject.
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixtureDir, FIXTURES, report, runCli } from './cli.ts';

const STAMP = 'figma-qa/__refs__/format.json';

describe.each(FIXTURES)('figma-qa migrate in fixtures/%s', (fixture) => {
    const stampFile = path.join(fixtureDir(fixture), STAMP);
    let committed = '';

    beforeEach(async () => {
        committed = await readFile(stampFile, 'utf8');
    });

    afterEach(async () => {
        await writeFile(stampFile, committed);
    });

    it('is a no-op on refs already in the kit\'s format', async () => {
        const result = await runCli(fixture, ['migrate']);

        expect(result.code, result.stderr).toBe(0);
        expect(result.stdout).toBe('ok    figma-qa/__refs__: refs format 1, up to date\nfigma-qa migrate: done\n');
        expect(await readFile(stampFile, 'utf8')).toBe(committed);
    });

    it('stamps refs committed before the stamp existed; --dry-run only says so', async () => {
        await rm(stampFile);

        const dry = await runCli(fixture, ['migrate', '--dry-run']);

        expect(dry.code, dry.stderr).toBe(0);
        expect(dry.stdout).toBe(`write ${STAMP}: refs format 1\nfigma-qa migrate: dry run, nothing written\n`);
        await expect(readFile(stampFile, 'utf8')).rejects.toThrow('ENOENT');

        const result = await runCli(fixture, ['migrate']);

        expect(result.code, result.stderr).toBe(0);
        expect(result.stdout).toBe(`write ${STAMP}: refs format 1\nfigma-qa migrate: done\n`);
        expect(await readFile(stampFile, 'utf8')).toBe(committed);
    });

    it('refuses refs from a newer kit, and report won\'t read them', async () => {
        await writeFile(stampFile, '{\n    "format": 2\n}\n');
        const newer = 'figma-qa/__refs__ is refs format 2; this kit reads format 1: upgrade the kit.';

        const result = await runCli(fixture, ['migrate']);

        expect(result.code).toBe(2);
        expect(result.stderr).toBe(`figma-qa migrate: ${newer}\n`);

        const run = await report(fixture, ['Swatch']);

        expect(run.code).toBe(2);
        expect(run.summary.errors).toEqual([newer]);
    });

    it('refuses a stamp it can\'t read', async () => {
        await writeFile(stampFile, '{ "format": "1" }\n');

        const result = await runCli(fixture, ['migrate']);

        expect(result.code).toBe(2);
        expect(result.stderr).toBe(
            'figma-qa migrate: figma-qa/__refs__/format.json: expected { "format": <positive integer> }.\n'
        );
    });
});
