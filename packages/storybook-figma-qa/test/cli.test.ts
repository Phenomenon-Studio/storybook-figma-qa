// Seam 1: the real `figma-qa` binary, run the way a consumer runs it, inside each fixture project.
import { execFile } from 'node:child_process';
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
