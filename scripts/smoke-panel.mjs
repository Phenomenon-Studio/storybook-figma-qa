// Smoke check of the kit's "Figma diff" panel in a real Storybook.
//
//   node scripts/smoke-panel.mjs <storybook-static dir>   built Storybook: the panel loads and, with no dev route,
//                                                          says a non-Figma story isn't one.
//   node scripts/smoke-panel.mjs --dev <fixture dir>       runs `figma-qa report` there, starts `storybook dev`, and
//                                                          checks the panel shows the run's verdict for a Figma story
//                                                          and the canvas renders its matrix from the dev route.
import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { openPanel, serveDev } from './storybook-dev.mjs';

const VERDICT_LABEL = { pass: 'Matches Figma', fail: 'Differs from Figma', error: 'Harness error' };
const dev = process.argv[2] === '--dev';
const target = resolve(process.argv[dev ? 3 : 2] ?? 'storybook-static');

async function serveStatic(root) {
    const MIME_TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
    const server = createServer((req, res) => {
        const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        let file = join(root, path);

        if (!file.startsWith(root) || !existsSync(file)) {
            res.writeHead(404).end();

            return;
        }

        if (statSync(file).isDirectory()) {
            file = join(file, 'index.html');
        }

        res.writeHead(200, { 'content-type': MIME_TYPES[extname(file)] ?? 'application/octet-stream' });
        createReadStream(file).pipe(res);
    });

    await new Promise((done) => {
        server.listen(0, '127.0.0.1', done);
    });

    return {
        url: `http://127.0.0.1:${server.address().port}`,
        stop: () => {
            server.close();
        },
    };
}

let server;
const browser = await chromium.launch();
try {
    const page = await browser.newPage();
    if (!dev) {
        server = await serveStatic(target);
        await openPanel(page, server.url, 'button--default');
        await page.getByText('Not a Figma story.').waitFor({ timeout: 10_000 });
        console.log('ok: "Figma diff" panel visible');
    } else {
        // Host Chromium: the panel is the subject here, not the pinned image a CI runner's Docker would pull.
        const run = spawnSync('pnpm', ['exec', 'figma-qa', 'report', 'SwatchDrift.figma', '--host-browser', '--json'], {
            cwd: target,
            encoding: 'utf8',
        });
        const story = JSON.parse(run.stdout).stories[0];
        server = await serveDev(target);
        await openPanel(page, server.url, story.storyId);
        const panel = page.locator(`[data-story-id="${story.storyId}"]`);
        // The verdict the CLI printed, rendered from the results the dev route serves.
        await panel.getByText(VERDICT_LABEL[story.verdict], { exact: true }).waitFor({ timeout: 30_000 });
        const verdict = await panel.getAttribute('data-verdict');
        if (verdict !== story.verdict) {
            throw new Error(`panel verdict ${verdict}, CLI verdict ${story.verdict}`);
        }
        const map = panel.getByRole('img', { name: 'What differs' }).first();
        await map.waitFor();
        // Visible is not loaded: wait for the image itself to settle, then check it decoded.
        const loaded = await map.evaluate((image) => {
            if (image.complete) {
                return image.naturalWidth > 0;
            }

            return new Promise((resolve) => {
                image.addEventListener('load', () => {
                    resolve(image.naturalWidth > 0);
                });
                image.addEventListener('error', () => {
                    resolve(false);
                });
            });
        });
        if (!loaded) {
            throw new Error('diff map image did not load from the dev route');
        }
        // The canvas renders the matrix from refs the dev route serves, as in a run.
        const cells = page.frameLocator('#storybook-preview-iframe').locator('[data-figma-variant]');
        await cells.first().waitFor({ timeout: 30_000 });
        const expected = story.cells.pass + story.cells.fail + story.cells.approved;
        if ((await cells.count()) !== expected) {
            throw new Error(`canvas renders ${await cells.count()} cells, the run measured ${expected}`);
        }
        const report = readFileSync(join(target, 'figma-qa/.results/report/index.html'), 'utf8');
        if (!report.includes(`data-story-id="${story.storyId}" data-verdict="${story.verdict}"`)) {
            throw new Error('HTML report verdict differs from the panel');
        }
        console.log(`ok: panel shows "${VERDICT_LABEL[story.verdict]}" for ${story.storyId}, as the CLI and the report`);
    }
} finally {
    await browser.close();
    server?.stop();
}
