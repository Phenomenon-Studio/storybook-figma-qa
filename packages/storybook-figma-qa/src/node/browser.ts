// The browser a report runs in. With Docker, the pinned Playwright image serves Chromium (`compose up --wait`), so
// pixels match CI; without it, or with `--host-browser`, the host's Chromium runs and the report says the pixels
// aren't comparable to CI. Docker present but the image failing to start is a harness error, not a quiet fallback.
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { BROWSER_PORT, BROWSER_PORT_ENV, BROWSER_WS_ENV } from '../constants.ts';

export type Browser =
    | { kind: 'image'; wsEndpoint: string }
    | {
          kind: 'host';
          /** Why the host's Chromium runs: the summary's warning. */
          reason: string;
      };

/** Compose project of the browser container: one per machine, reused across runs and projects. */
const COMPOSE_PROJECT = 'figma-qa';
/** Port the Playwright server listens on inside the container; the host side is `BROWSER_PORT`. */
const CONTAINER_PORT = 3100;

export function dockerRunning(): Promise<boolean> {
    return new Promise((resolve) => {
        // `docker info` needs the daemon: an installed but stopped Docker counts as absent.
        execFile('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: 15_000 }, (error) => {
            resolve(!error);
        });
    });
}

/**
 * The project's Playwright version. The image is pinned to it: a remote Playwright server only accepts clients of its
 * own version, and the lockfile pins it for CI too.
 */
function playwrightVersion(root: string): string {
    const require = createRequire(path.join(root, 'package.json'));
    const manifest = require('playwright/package.json') as { version: string };

    return manifest.version;
}

/**
 * The secret endpoint path of the browser server. The container stays up between runs, so without it any local
 * process or web page could drive its Chromium. One per user (the container is per machine): a token that changed
 * every run would recreate the container each time.
 */
async function serverToken(): Promise<string> {
    const file = path.join(process.env.XDG_CACHE_HOME ?? path.join(homedir(), '.cache'), 'figma-qa', 'browser-token');
    const existing = (await readFile(file, 'utf8').catch(() => {
        return '';
    })).trim();
    if (/^[0-9a-f]{48}$/.test(existing)) {
        return existing;
    }
    const token = randomBytes(24).toString('hex');
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, token, { mode: 0o600 });

    return token;
}

function composeFile(image: string, version: string, port: number, token: string): string {
    // The healthcheck makes `up --wait` return only once the server accepts connections.
    const probe = `require('net').connect(${CONTAINER_PORT}, '127.0.0.1').on('connect', () => process.exit(0)).on('error', () => process.exit(1))`;

    return JSON.stringify({
        services: {
            browser: {
                image,
                init: true,
                user: 'pwuser',
                working_dir: '/home/pwuser',
                command: [
                    '/bin/sh',
                    '-c',
                    `npx -y playwright@${version} run-server --port ${CONTAINER_PORT} --host 0.0.0.0 --path /${token}`,
                ],
                ports: [`127.0.0.1:${port}:${CONTAINER_PORT}`],
                healthcheck: {
                    test: ['CMD', 'node', '-e', probe],
                    interval: '1s',
                    timeout: '5s',
                    retries: 30,
                    start_period: '180s',
                },
            },
        },
    });
}

/** `docker compose up --wait` with the file on stdin; its output goes to stderr so `--json` stdout stays clean. */
function composeUp(file: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn('docker', ['compose', '-p', COMPOSE_PROJECT, '-f', '-', 'up', '--wait', '--wait-timeout', '300'], {
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        // Docker's own last line names the cause (a pull failure, a taken port): it leads the error.
        let last = '';
        child.stdout.pipe(process.stderr);
        child.stderr.on('data', (chunk: Buffer) => {
            process.stderr.write(chunk);
            last = chunk.toString().trim().split('\n').pop() ?? last;
        });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(last || `docker compose up exited ${code}`));
            }
        });
        child.stdin.end(file);
    });
}

export async function pickBrowser(root: string, options: { hostBrowser: boolean; ci: boolean }): Promise<Browser> {
    if (options.hostBrowser) {
        return { kind: 'host', reason: '--host-browser' };
    }
    if (options.ci) {
        // CI never starts Docker: the job runs the pinned image as a service container and names its endpoint.
        const wsEndpoint = process.env[BROWSER_WS_ENV];

        return wsEndpoint ? { kind: 'image', wsEndpoint } : { kind: 'host', reason: `--ci without ${BROWSER_WS_ENV}` };
    }
    if (!(await dockerRunning())) {
        return { kind: 'host', reason: 'Docker is not running' };
    }
    let version: string;
    try {
        version = playwrightVersion(root);
    } catch {
        throw new Error('Pinned browser: playwright is not installed in this project; run `figma-qa init`.');
    }
    const image = `mcr.microsoft.com/playwright:v${version}-noble`;
    const port = Number(process.env[BROWSER_PORT_ENV] ?? BROWSER_PORT);
    const token = await serverToken();
    try {
        await composeUp(composeFile(image, version, port, token));
    } catch (error) {
        throw new Error(
            `Pinned browser ${image} did not start (${error instanceof Error ? error.message : String(error)}); ` +
                'rerun with --host-browser to use this machine’s Chromium.',
            { cause: error }
        );
    }

    return { kind: 'image', wsEndpoint: `ws://127.0.0.1:${port}/${token}` };
}
