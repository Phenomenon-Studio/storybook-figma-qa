// Runs the real `figma-qa` binary the way a consumer does, inside a fixture project.
import { execFile, spawn } from 'node:child_process';
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
    return await runIn(fixtureDir(fixture), ['pnpm', 'exec', 'figma-qa', ...args], env);
}

/** The kit's own build, for projects with no installed kit (init refusals). */
export const KIT_BIN = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** `command` in `cwd`, e.g. `['pnpm', 'exec', 'figma-qa', 'init']` in a fixture copy. */
export async function runIn(cwd: string, command: string[], env: Record<string, string> = {}) {
    const { FIGMA_TOKEN: _token, FIGMA_API_URL: _api, FIGMA_QA_REFRESH: _refresh, ...base } = process.env;
    const [bin = '', ...args] = command;
    try {
        const { stdout, stderr } = await execFileAsync(bin, args, {
            // A report that prompted would hang here, not read an answer.
            timeout: 300_000,
            cwd,
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
    hostBrowser: boolean;
    cells: Cells;
    files: string[];
    stories: {
        storyId: string;
        verdict: string;
        cells: Cells;
        error: string | null;
        results: string | null;
        failing: { block: string; variant: string; triage: string | null; approved: string | null }[];
    }[];
    errors: string[];
    warnings: string[];
    timings: Record<string, number>;
    panelUrl: string | null;
};
export type StoryResult = {
    error: string | null;
    warnings: string[];
    blocks: {
        cells: {
            variant: { name: string; props: Record<string, string> };
            status: string;
            approval: string | null;
            triage: string | null;
        }[];
    }[];
};

/**
 * `figma-qa report <args> --host-browser --json`: Docker may be on the machine, and the pinned image is
 * local-report.test.ts's subject, behind a fake Docker (`json()` there).
 */
export async function report(fixture: Fixture, args: string[], env: Record<string, string> = {}) {
    return json(await runCli(fixture, ['report', ...args, '--host-browser', '--json'], env));
}

/** The run warning every `report()` carries: it passes `--host-browser`. */
export const HOST_WARNING = 'Host Chromium (--host-browser): pixels are not comparable to CI.';

/** Parses a `--json` run's stdout. */
export function json(result: { code: number; stdout: string; stderr: string }) {
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

/**
 * Runs the CLI behind a pseudo-terminal: `script` gives it a TTY stdout, as in a developer's shell. `script` needs a
 * plain file as stdin, not a pipe, so stdin is /dev/null. Resolves with stdout.
 */
export function inTerminal(fixture: Fixture, args: string[], env: Record<string, string>): Promise<string> {
    const command = ['pnpm', 'exec', 'figma-qa', ...args];
    const scriptArgs =
        process.platform === 'darwin' ? ['-q', '/dev/null', ...command] : ['-qec', command.join(' '), '/dev/null'];
    const { FIGMA_TOKEN: _token, FIGMA_API_URL: _api, ...base } = process.env;
    const child = spawn('script', scriptArgs, {
        cwd: fixtureDir(fixture),
        env: { ...base, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
    });

    // Exit 1 or 2 is a verdict here, not a test failure.
    return new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('close', () => {
            resolve(stdout);
        });
    });
}
