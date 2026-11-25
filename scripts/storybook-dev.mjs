// Storybook dev helpers shared by the smoke check and the docs screenshots.
import { spawn } from 'node:child_process';

/** `storybook dev` in the fixture, resolved once it prints its local URL. */
export async function serveDev(fixture) {
    const port = 6100 + Math.floor(Math.random() * 800);
    const child = spawn('pnpm', ['exec', 'storybook', 'dev', '--ci', '--port', String(port)], {
        cwd: fixture,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
    });
    let output = '';
    await new Promise((done, fail) => {
        const timer = setTimeout(() => {
            process.kill(-child.pid);
            fail(new Error(`storybook dev did not start:\n${output}`));
        }, 120_000);
        const read = (chunk) => {
            output += chunk;
            if (output.includes(`:${port}/`)) {
                clearTimeout(timer);
                done();
            }
        };
        child.stdout.on('data', read);
        child.stderr.on('data', read);
        child.on('exit', (code) => {
            clearTimeout(timer);
            fail(new Error(`storybook dev exited ${code}:\n${output}`));
        });
    });

    return {
        url: `http://127.0.0.1:${port}`,
        stop: () => {
            child.removeAllListeners('exit');
            process.kill(-child.pid);
        },
    };
}

/** Opens a story with the "Figma diff" panel selected. `query` adds Storybook URL params, e.g. `&nav=false`. */
export async function openPanel(page, url, storyId, query = '') {
    await page.goto(`${url}/?path=/story/${storyId}${query}`);
    await page.getByRole('tab', { name: 'Figma diff' }).click({ timeout: 60_000 });
}
