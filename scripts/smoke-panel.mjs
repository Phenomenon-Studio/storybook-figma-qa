// Smoke check: a built Storybook loads the kit addon and shows its empty panel.
// Usage: node scripts/smoke-panel.mjs <storybook-static dir>
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(process.argv[2] ?? 'storybook-static');
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

const { port } = server.address();
const browser = await chromium.launch();

try {
    const page = await browser.newPage();

    await page.goto(`http://127.0.0.1:${port}/?path=/story/button--default`);
    await page.getByRole('tab', { name: 'Figma diff' }).click({ timeout: 30_000 });
    await page.getByText('No Figma results yet.').waitFor({ timeout: 10_000 });
    console.log('ok: "Figma diff" panel visible');
} finally {
    await browser.close();
    server.close();
}
