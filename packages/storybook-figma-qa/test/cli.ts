// Runs the real `figma-qa` binary the way a consumer does, inside a fixture project.
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const FIXTURES = ['sb10', 'sb11'] as const;

export type Fixture = (typeof FIXTURES)[number];

export function fixtureDir(fixture: Fixture) {
    return fileURLToPath(new URL(`../../../fixtures/${fixture}`, import.meta.url));
}

/** `execFile` rejects on non-zero exit with the exit code and output on the error. */
function isExitError(error: unknown): error is Error & { code: number; stdout: string; stderr: string } {
    return error instanceof Error && typeof (error as { code?: unknown }).code === 'number';
}

/** No Figma token or API override leaks in from the caller's shell: runs are offline unless `env` says otherwise. */
export async function runCli(fixture: Fixture, args: string[], env: Record<string, string> = {}) {
    const { FIGMA_TOKEN: _token, FIGMA_API_URL: _api, FIGMA_QA_REFRESH: _refresh, ...base } = process.env;
    try {
        const { stdout, stderr } = await execFileAsync('pnpm', ['exec', 'figma-qa', ...args], {
            cwd: fixtureDir(fixture),
            env: { ...base, ...env },
        });

        return { code: 0, stdout, stderr };
    } catch (error) {
        if (!isExitError(error)) {
            throw error;
        }

        return { code: error.code, stdout: error.stdout, stderr: error.stderr };
    }
}

export type Cells = { pass: number; fail: number; approved: number; missing: number };
export type Summary = {
    exitCode: number;
    cells: Cells;
    stories: { storyId: string; verdict: string; cells: Cells; error: string | null; results: string | null }[];
    errors: string[];
    warnings: string[];
};
export type StoryResult = {
    error: string | null;
    warnings: string[];
    blocks: { cells: { variant: { name: string }; status: string; approval: string | null }[] }[];
};

/** `figma-qa report <args> --json`. */
export async function report(fixture: Fixture, args: string[], env: Record<string, string> = {}) {
    const result = await runCli(fixture, ['report', ...args, '--json'], env);
    // stdout holds only the summary: anything else there fails the parse.
    const summary = JSON.parse(result.stdout) as Summary;

    return { ...result, summary };
}

export async function storyResult(fixture: Fixture, file: string | null): Promise<StoryResult> {
    if (!file) {
        throw new Error('Story wrote no results.');
    }

    return JSON.parse(await readFile(path.join(fixtureDir(fixture), file), 'utf8')) as StoryResult;
}
