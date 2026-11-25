// Format of a project's committed figma-qa state, and the steps that carry it forward. `<refsDir>/format.json` records
// the format the committed refs (and the config beside them) are in; refs committed before the stamp existed are
// format 1. Any config or refs format change is a major release and appends one step here (docs/upgrading.md).
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readJson } from './json.ts';

export type MigrationProject = { root: string; refsDir: string };

/**
 * Carries the committed refs and config one format forward. Re-run on failure (the stamp moves only after a step
 * finishes), so it must be idempotent: a step that half ran is run again.
 */
export type MigrationStep = { description: string; run: (project: MigrationProject) => Promise<void> };

/**
 * In order: `STEPS[n]` migrates format n + 1 to n + 2. Append only; a released step never changes.
 * The first step that changes the config format must also change how `figma-qa migrate` starts: it validates the config
 * (for `refsDir`) before any step, so an old config the new kit rejects stops it, and it runs no step without refs.
 */
export const STEPS: readonly MigrationStep[] = [];

/** The format this kit reads and writes. */
export const REFS_FORMAT = STEPS.length + 1;

export const FORMAT_FILE = 'format.json';

/** A stamp the kit can't read, or refs from a newer kit: a setup error (exit 2). */
export class MigrateError extends Error {
    override name = 'MigrateError';
}

type Stamp = { format: number };

function stampFile({ root, refsDir }: MigrationProject): string {
    return path.join(root, refsDir, FORMAT_FILE);
}

/** The recorded format; null when there is no stamp. */
async function readStamp(project: MigrationProject): Promise<number | null> {
    let stamp: Partial<Stamp> | null;
    try {
        stamp = await readJson<Partial<Stamp>>(stampFile(project));
    } catch (error) {
        throw new MigrateError(`${project.refsDir}/${FORMAT_FILE}: unreadable (${(error as Error).message}).`);
    }
    if (stamp === null) {
        return null;
    }
    if (!Number.isInteger(stamp.format) || (stamp.format as number) < 1) {
        throw new MigrateError(`${project.refsDir}/${FORMAT_FILE}: expected { "format": <positive integer> }.`);
    }

    return stamp.format as number;
}

/** Any committed file counts, `variables.json` alone included: it is part of the refs format too. */
async function hasRefs({ root, refsDir }: MigrationProject): Promise<boolean> {
    try {
        return (await readdir(path.join(root, refsDir))).some((entry) => {
            // `.DS_Store` and the like are not refs.
            return !entry.startsWith('.');
        });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}

/** The committed refs' format: null when nothing is committed yet. Rejects with MigrateError on a bad stamp. */
export async function refsFormat(project: MigrationProject): Promise<number | null> {
    return formatOf(project, await readStamp(project));
}

async function formatOf(project: MigrationProject, stamp: number | null): Promise<number | null> {
    if (stamp !== null) {
        return stamp;
    }

    return (await hasRefs(project)) ? 1 : null;
}

export async function writeRefsFormat(project: MigrationProject, format: number): Promise<void> {
    await mkdir(path.join(project.root, project.refsDir), { recursive: true });
    await writeFile(stampFile(project), `${JSON.stringify({ format } satisfies Stamp, null, 4)}\n`);
}

/** Sync writes refs in this kit's format: it stamps a refs dir that has no stamp yet. */
export async function ensureRefsFormat(project: MigrationProject): Promise<void> {
    if ((await readStamp(project)) === null) {
        await writeRefsFormat(project, REFS_FORMAT);
    }
}

/** Why this kit can't read the committed refs, or null when it can (or there are none). */
export async function refsFormatBlocked(project: MigrationProject): Promise<string | null> {
    let format: number | null;
    try {
        format = await refsFormat(project);
    } catch (error) {
        return (error as Error).message;
    }
    if (format === null || format === REFS_FORMAT) {
        return null;
    }

    return formatError(project, format, REFS_FORMAT);
}

function formatError(project: MigrationProject, format: number, current: number): string {
    const fix = format < current ? 'run `figma-qa migrate`' : 'upgrade the kit';

    return `${project.refsDir} is refs format ${format}; this kit reads format ${current}: ${fix}.`;
}

export type MigrateOptions = {
    dryRun: boolean;
    line: (status: 'ok' | 'write' | 'run', text: string) => void;
    /** The kit's steps by default; tests pass their own. */
    steps?: readonly MigrationStep[];
};

/** Runs every step after the recorded format, stamping after each. No-op when up to date. */
export async function migrate(project: MigrationProject, options: MigrateOptions): Promise<void> {
    const steps = options.steps ?? STEPS;
    const current = steps.length + 1;
    const stamp = await readStamp(project);
    const format = await formatOf(project, stamp);
    if (format === null) {
        options.line('ok', `${project.refsDir}: no committed refs, nothing to migrate`);

        return;
    }
    if (format > current) {
        throw new MigrateError(formatError(project, format, current));
    }
    for (const [index, step] of steps.slice(format - 1).entries()) {
        const from = format + index;
        options.line('run', `refs format ${from} → ${from + 1}: ${step.description}`);
        if (!options.dryRun) {
            try {
                await step.run(project);
            } catch (error) {
                // A failed step is a setup error (exit 2), and the stamp still names the format the refs are in.
                throw new MigrateError(`refs format ${from} → ${from + 1} failed: ${(error as Error).message}`);
            }
            await writeRefsFormat(project, from + 1);
        }
    }
    if (format < current) {
        return;
    }
    if (stamp === null) {
        options.line('write', `${project.refsDir}/${FORMAT_FILE}: refs format ${current}`);
        if (!options.dryRun) {
            await writeRefsFormat(project, current);
        }
    } else {
        options.line('ok', `${project.refsDir}: refs format ${current}, up to date`);
    }
}
