// `figma-qa report` as the one local command, through the real CLI in each fixture: which story files it collects,
// how filters narrow them, which browser it picks (a fake Docker on PATH serves the "pinned image" with the project's
// own Playwright), phase timings, the doctor-blocked state, opening the report and the running Storybook's panel URL.
import type { ChildProcess } from 'node:child_process';
import type { Fixture } from './cli.ts';
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixtureDir, FIXTURES, HOST_WARNING, json, report, runCli } from './cli.ts';

const FAKE_DOCKER = fileURLToPath(new URL('./fake-docker', import.meta.url));

/**
 * Playwright's installed browsers. On Linux they live under `$XDG_CACHE_HOME`, which the browser tests point at a temp
 * dir for the token: pin the real location first, or neither host Chromium nor the fake image's server finds one.
 */
const PLAYWRIGHT_BROWSERS: Record<string, string> =
    process.platform === 'linux' && !process.env.PLAYWRIGHT_BROWSERS_PATH
        ? {
              PLAYWRIGHT_BROWSERS_PATH: path.join(
                  process.env.XDG_CACHE_HOME ?? path.join(homedir(), '.cache'),
                  'ms-playwright'
              ),
          }
        : {};
const FIGMA_FILES = [
    'src/Glyph.figma.stories.tsx',
    'src/Misconfigured.figma.stories.tsx',
    'src/Swatch.figma.stories.tsx',
    'src/SwatchDrift.figma.stories.tsx',
    'src/SwatchToken.figma.stories.tsx',
    'src/SwatchTriage.figma.stories.tsx',
];
const PHASES = ['doctor', 'browser', 'collect', 'tests', 'report'];

function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address() as net.AddressInfo;
            server.close(() => {
                resolve(port);
            });
        });
    });
}

async function until(check: () => Promise<boolean>, timeout: number): Promise<boolean> {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
        if (await check()) {
            return true;
        }
        await new Promise((resolve) => {
            setTimeout(resolve, 250);
        });
    }

    return false;
}

function ids(summary: { stories: { storyId: string }[] }): string[] {
    return summary.stories.map((story) => {
        return story.storyId;
    });
}

describe.each(FIXTURES)('figma-qa report collects and filters in fixtures/%s', (fixture) => {
    it('collects only story files with a figma tag, or a tag it cannot read, and times every phase', async () => {
        const { summary } = await report(fixture, []);

        // Button.stories.tsx has no figma tag; Glyph's tags are a same-file const.
        expect([...summary.files].sort()).toEqual(FIGMA_FILES);
        expect(summary.stories).toHaveLength(8);
        expect(summary.exitCode).toBe(2);
        expect(Object.keys(summary.timings)).toEqual(PHASES);
        for (const phase of PHASES) {
            expect(summary.timings[phase]).toBeGreaterThanOrEqual(0);
        }
        expect(summary.panelUrl).toBeNull();
        const html = await readFile(path.join(fixtureDir(fixture), 'figma-qa/.results/report/index.html'), 'utf8');
        expect(html).toContain('aria-label="Timings"');
        expect(html).toMatch(/data-phase="tests"/);
    });

    it('keeps the files a component name matches', async () => {
        const { summary } = await report(fixture, ['Swatch']);

        expect([...summary.files].sort()).toEqual([
            'src/Misconfigured.figma.stories.tsx',
            'src/Swatch.figma.stories.tsx',
            'src/SwatchDrift.figma.stories.tsx',
            'src/SwatchToken.figma.stories.tsx',
            'src/SwatchTriage.figma.stories.tsx',
        ]);
    });

    it('runs only the stories a story-id glob matches, even inside a collected file', async () => {
        const { code, summary } = await report(fixture, ['swatch-figma-misconfigured--no-matrix', '*-drift--*']);

        expect(code).toBe(2);
        expect([...summary.files].sort()).toEqual([
            'src/Misconfigured.figma.stories.tsx',
            'src/SwatchDrift.figma.stories.tsx',
        ]);
        expect(ids(summary).sort()).toEqual(['swatch-figma-drift--matrix', 'swatch-figma-misconfigured--no-matrix']);
    });

    it('exits 2 when no Figma story matches the filters', async () => {
        const { code, summary } = await report(fixture, ['Nope']);

        expect(code).toBe(2);
        expect(summary.errors).toEqual(['No Figma story matches Nope.']);
    });
});

describe.each(FIXTURES)('figma-qa report picks a browser in fixtures/%s', (fixture) => {
    let dir: string;
    let env: Record<string, string>;

    beforeEach(async () => {
        dir = await mkdtemp(path.join(tmpdir(), 'figma-qa-docker-'));
        env = {
            PATH: `${FAKE_DOCKER}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_DOCKER_LOG: path.join(dir, 'calls.jsonl'),
            FAKE_DOCKER_PID: path.join(dir, 'server.pid'),
            FIGMA_QA_BROWSER_PORT: String(await freePort()),
            // The browser token lands here, not in the developer's cache.
            XDG_CACHE_HOME: dir,
            ...PLAYWRIGHT_BROWSERS,
        };
    });

    afterEach(async () => {
        const pid = await readFile(env.FAKE_DOCKER_PID ?? '', 'utf8').catch(() => {
            return null;
        });
        if (pid) {
            try {
                process.kill(Number(pid));
            } catch {
                // Already gone.
            }
        }
        await rm(dir, { recursive: true, force: true });
    });

    async function calls(): Promise<unknown[]> {
        const text = await readFile(env.FAKE_DOCKER_LOG ?? '', 'utf8').catch(() => {
            return '';
        });

        return text
            .split('\n')
            .filter(Boolean)
            .map((line) => {
                return JSON.parse(line) as unknown;
            });
    }

    function run(args: string[], mode: string) {
        return runCli(fixture, ['report', 'swatch-figma--matrix', ...args, '--json'], { ...env, FAKE_DOCKER: mode });
    }

    it('starts the pinned image when Docker runs, and connects to it', async () => {
        const { code, stderr, summary } = json(await run([], 'up'));

        expect(code, stderr).toBe(0);
        expect(summary.hostBrowser).toBe(false);
        expect(summary.warnings).toEqual([]);
        expect(summary.cells).toEqual({ pass: 2, fail: 0, approved: 2, missing: 2 });
        const [info, compose, file] = await calls();
        expect(info).toEqual(['info', '--format', '{{.ServerVersion}}']);
        expect(compose).toEqual(expect.arrayContaining(['compose', 'up', '--wait']));
        const { version } = JSON.parse(
            await readFile(path.join(fixtureDir(fixture), 'node_modules/playwright/package.json'), 'utf8')
        ) as { version: string };
        expect(file).toMatchObject({
            services: { browser: { image: `mcr.microsoft.com/playwright:v${version}-noble` } },
        });
        // The server answers only on a per-user secret path.
        const token = await readFile(path.join(dir, 'figma-qa/browser-token'), 'utf8');
        expect(token).toMatch(/^[0-9a-f]{48}$/);
        expect(JSON.stringify(file)).toContain(`--path /${token}`);
    });

    it('falls back to host Chromium with a warning when Docker is not running', async () => {
        const { code, summary } = json(await run([], 'down'));

        expect(code).toBe(0);
        expect(summary.hostBrowser).toBe(true);
        expect(summary.warnings).toEqual(['Host Chromium (Docker is not running): pixels are not comparable to CI.']);
        const html = await readFile(path.join(fixtureDir(fixture), 'figma-qa/.results/report/index.html'), 'utf8');
        expect(html).toContain('pixels are not comparable to CI');
    });

    it('uses host Chromium without asking Docker under --host-browser', async () => {
        const { code, summary } = json(await run(['--host-browser'], 'up'));

        expect(code).toBe(0);
        expect(summary.hostBrowser).toBe(true);
        expect(summary.warnings).toEqual([HOST_WARNING]);
        expect(await calls()).toEqual([]);
    });

    it('exits 2 when the pinned image does not start, naming the cause and the fallback', async () => {
        const { code, summary } = json(await run([], 'fail'));

        expect(code).toBe(2);
        expect(summary.stories).toEqual([]);
        expect(summary.errors[0]).toContain('port is already allocated');
        expect(summary.errors[0]).toContain('--host-browser');
    });
});

describe.each(FIXTURES)('figma-qa report on a project init has not set up, in fixtures/%s', (fixture) => {
    const root = fixtureDir(fixture);
    const files = ['.storybook/main.ts', 'vitest.config.ts'];
    const saved = new Map<string, string>();

    beforeEach(async () => {
        for (const file of files) {
            saved.set(file, await readFile(path.join(root, file), 'utf8'));
        }
    });

    afterEach(async () => {
        for (const [file, source] of saved) {
            await writeFile(path.join(root, file), source);
        }
    });

    async function edit(file: string, from: string, to: string) {
        const source = saved.get(file) ?? '';
        expect(source).toContain(from);
        await writeFile(path.join(root, file), source.replace(from, to));
    }

    it('exits 2 pointing at init when the kit addon is missing from .storybook/main', async () => {
        await edit('.storybook/main.ts', "addons: ['@phenomenon-studio/storybook-figma-qa']", 'addons: []');
        const { code, summary } = await report(fixture, []);

        expect(code).toBe(2);
        expect(summary.errors).toEqual([
            '.storybook/main.ts does not add @phenomenon-studio/storybook-figma-qa to addons: run `figma-qa init`.',
        ]);
    });

    it('exits 2 pointing at init when Vitest has no Figma project', async () => {
        await edit('vitest.config.ts', 'projects: [figmaQa()]', 'projects: []');
        const { code, summary } = await report(fixture, []);

        expect(code).toBe(2);
        expect(summary.errors[0]).toMatch(/No "figma-qa" Vitest project.*run `figma-qa init`/);
    });
});

/**
 * Runs the CLI behind a pseudo-terminal: `script` gives it a TTY stdout, as in a developer's shell. `script` needs a
 * plain file as stdin, not a pipe, so stdin is /dev/null.
 */
function inTerminal(fixture: Fixture, args: string[], env: Record<string, string>): Promise<string> {
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

describe.skipIf(process.platform === 'win32').each(FIXTURES)('figma-qa report opens the report in fixtures/%s', (fixture) => {
    let dir: string;
    let env: Record<string, string>;

    beforeEach(async () => {
        dir = await mkdtemp(path.join(tmpdir(), 'figma-qa-open-'));
        const opener = path.join(dir, 'open');
        await writeFile(opener, '#!/bin/sh\nprintf %s "$1" > "$OPENED"\n');
        await chmod(opener, 0o755);
        // CI sets CI=true, and a CI run opens nothing.
        env = { BROWSER: opener, OPENED: path.join(dir, 'opened'), CI: '' };
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    function opened() {
        return readFile(env.OPENED ?? '', 'utf8').catch(() => {
            return null;
        });
    }

    it('opens the HTML report from a terminal and prints the host-browser warning', async () => {
        const stdout = await inTerminal(fixture, ['report', 'swatch-figma--matrix', '--host-browser'], env);

        expect(stdout).toContain('WARN  Host Chromium (--host-browser): pixels are not comparable to CI.');
        expect(stdout).toMatch(/Timings: doctor .* s, browser .* s, collect .* s, tests .* s, report .* s/);
        expect(
            await until(async () => {
                return (await opened()) !== null;
            }, 10_000)
        ).toBe(true);
        expect(await opened()).toBe(path.join(fixtureDir(fixture), 'figma-qa/.results/report/index.html'));
    });

    it('opens nothing with --no-open', async () => {
        await inTerminal(fixture, ['report', 'swatch-figma--matrix', '--host-browser', '--no-open'], env);
        await new Promise((resolve) => {
            setTimeout(resolve, 1000);
        });

        expect(await opened()).toBeNull();
    });

    it('opens nothing without a terminal', async () => {
        await runCli(fixture, ['report', 'swatch-figma--matrix', '--host-browser'], env);
        await new Promise((resolve) => {
            setTimeout(resolve, 1000);
        });

        expect(await opened()).toBeNull();
    });
});

describe.each(FIXTURES)('figma-qa report with Storybook running in fixtures/%s', (fixture) => {
    let storybook: ChildProcess | null = null;

    afterEach(() => {
        if (storybook?.pid) {
            // The whole group: pnpm, Storybook and its children.
            process.kill(-storybook.pid, 'SIGTERM');
        }
        storybook = null;
    });

    it('prints the Figma diff panel URL of the story to look at', { timeout: 300_000 }, async () => {
        const port = await freePort();
        // `--ci`: no prompts, no browser tab (Storybook 11 has no `--no-open`).
        storybook = spawn('pnpm', ['exec', 'storybook', 'dev', '-p', String(port), '--ci'], {
            cwd: fixtureDir(fixture),
            detached: true,
            stdio: 'ignore',
        });
        const up = await until(async () => {
            return fetch(`http://localhost:${port}/index.json`).then(
                (response) => {
                    return response.ok;
                },
                () => {
                    return false;
                }
            );
        }, 120_000);
        expect(up).toBe(true);

        const { stdout } = await runCli(fixture, ['report', 'swatch-figma--matrix', '--host-browser']);

        // Storybook's own local address: `localhost` or the loopback IP, by version.
        expect(stdout).toMatch(
            new RegExp(
                `Figma diff panel: http://(localhost|127\\.0\\.0\\.1):${port}/\\?path=/story/swatch-figma--matrix&addonPanel=phenomenon-studio%2Fstorybook-figma-qa%2Fpanel\n`
            )
        );
    });
});
