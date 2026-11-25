// The migration runner with steps the kit doesn't ship yet: which steps run, in what order, and how the format stamp
// tracks them. The `figma-qa migrate` binary, with the kit's real (empty) step list, is migrate-cli.test.ts's subject.
import type { MigrationProject, MigrationStep } from '../src/node/migrate.ts';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FORMAT_FILE, MigrateError, migrate, refsFormat } from '../src/node/migrate.ts';

const REFS = 'figma-qa/__refs__';

describe('migration runner', () => {
    let project: MigrationProject;
    let ran: string[];
    let lines: string[];

    function step(name: string): MigrationStep {
        return {
            description: name,
            run: async ({ root, refsDir }) => {
                ran.push(`${name} at ${JSON.stringify(await readFile(path.join(root, refsDir, FORMAT_FILE), 'utf8').catch(() => {
                    return null;
                }))}`);
            },
        };
    }

    async function run(steps: MigrationStep[], dryRun = false) {
        await migrate(project, {
            steps,
            dryRun,
            line: (status, text) => {
                lines.push(`${status} ${text}`);
            },
        });
    }

    async function stamp(): Promise<unknown> {
        return JSON.parse(await readFile(path.join(project.root, REFS, FORMAT_FILE), 'utf8'));
    }

    async function setRefs(format: number | null) {
        await mkdir(path.join(project.root, REFS, 'KIT-1-0'), { recursive: true });
        if (format !== null) {
            await writeFile(path.join(project.root, REFS, FORMAT_FILE), `${JSON.stringify({ format })}\n`);
        }
    }

    beforeEach(async () => {
        project = { root: await mkdtemp(path.join(tmpdir(), 'figma-qa-migrate-')), refsDir: REFS };
        ran = [];
        lines = [];
    });

    afterEach(async () => {
        await rm(project.root, { recursive: true, force: true });
    });

    it('runs every step after the recorded format, in order, stamping after each', async () => {
        await setRefs(2);

        await run([step('a'), step('b'), step('c'), step('d')]);

        expect(ran).toEqual([
            'b at "{\\"format\\":2}\\n"',
            'c at "{\\n    \\"format\\": 3\\n}\\n"',
            'd at "{\\n    \\"format\\": 4\\n}\\n"',
        ]);
        expect(await stamp()).toEqual({ format: 5 });
        expect(lines).toEqual(['run refs format 2 → 3: b', 'run refs format 3 → 4: c', 'run refs format 4 → 5: d']);
    });

    it('reads refs without a stamp as format 1', async () => {
        await setRefs(null);

        expect(await refsFormat(project)).toBe(1);
        await run([step('a')]);

        expect(ran).toEqual(['a at null']);
        expect(await stamp()).toEqual({ format: 2 });
    });

    it('is a no-op when up to date, and stamps unstamped refs of the current format', async () => {
        await setRefs(null);

        await run([]);
        await run([]);

        expect(ran).toEqual([]);
        expect(await stamp()).toEqual({ format: 1 });
        expect(lines).toEqual([`write ${REFS}/${FORMAT_FILE}: refs format 1`, `ok ${REFS}: refs format 1, up to date`]);
    });

    it('does nothing without committed refs', async () => {
        expect(await refsFormat(project)).toBeNull();

        await run([step('a')]);

        expect(ran).toEqual([]);
        expect(lines).toEqual([`ok ${REFS}: no committed refs, nothing to migrate`]);
    });

    it('--dry-run lists the steps and runs or writes nothing', async () => {
        await setRefs(null);

        await run([step('a'), step('b')], true);

        expect(ran).toEqual([]);
        expect(lines).toEqual(['run refs format 1 → 2: a', 'run refs format 2 → 3: b']);
        expect(await refsFormat(project)).toBe(1);
    });

    it('a failed step leaves the stamp at the last step that finished, so a re-run resumes there', async () => {
        await setRefs(1);
        const failing: MigrationStep = {
            description: 'b',
            run: () => {
                return Promise.reject(new Error('disk full'));
            },
        };

        await expect(run([step('a'), failing, step('c')])).rejects.toThrow(new MigrateError('refs format 2 → 3 failed: disk full'));

        expect(await stamp()).toEqual({ format: 2 });
        await run([step('a'), step('b'), step('c')]);
        expect(ran).toEqual(['a at "{\\"format\\":1}\\n"', 'b at "{\\n    \\"format\\": 2\\n}\\n"', 'c at "{\\n    \\"format\\": 3\\n}\\n"']);
    });

    it('refuses refs from a newer kit and a stamp it cannot read', async () => {
        await setRefs(3);
        await expect(run([step('a')])).rejects.toThrow(new MigrateError(`${REFS} is refs format 3; this kit reads format 2: upgrade the kit.`));

        await writeFile(path.join(project.root, REFS, FORMAT_FILE), '{ "format": "1" }\n');
        await expect(refsFormat(project)).rejects.toThrow(MigrateError);
        expect(ran).toEqual([]);
    });
});
