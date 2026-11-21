// Seam 1: the real `figma-qa` binary, run the way a consumer runs it, inside each fixture project.
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);
const FIXTURES = ['sb10', 'sb11'] as const;

function fixtureDir(name: string) {
    return fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url));
}

async function figmaQa(fixture: string, args: string[]) {
    try {
        const { stdout, stderr } = await run('pnpm', ['exec', 'figma-qa', ...args], { cwd: fixtureDir(fixture) });

        return { code: 0, stdout, stderr };
    } catch (error) {
        const { code, stdout, stderr } = error as { code: number; stdout: string; stderr: string };

        return { code, stdout, stderr };
    }
}

describe.each(FIXTURES)('figma-qa in fixtures/%s', (fixture) => {
    it('doctor exits 0', async () => {
        const result = await figmaQa(fixture, ['doctor']);

        expect(result.code, result.stderr).toBe(0);
        expect(result.stdout).toContain('doctor');
    });

    it('unknown command exits 2 with usage', async () => {
        const result = await figmaQa(fixture, ['nope']);

        expect(result.code).toBe(2);
        expect(result.stderr).toContain('Usage: figma-qa');
    });
});
