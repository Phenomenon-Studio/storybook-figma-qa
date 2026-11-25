// Screenshots for the docs site (docs/assets/), from a real report run in fixtures/sb11: never a client project.
//
//   node scripts/docs-screenshots.mjs
//
// Rerun after changing what the results UI (src/ui/) draws. Needs a built kit (`pnpm build`) and Playwright's
// Chromium. Host Chromium on purpose: the shots show the UI, and the host-browser banner is one of them.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { serveDev } from './storybook-dev.mjs';

const fixture = resolve('fixtures/sb11');
const out = resolve('docs/assets');
const PASSING = 'swatch-figma--matrix';
const FAILING = 'swatch-figma-triage--matrix';

// Swatch passes (with approved and missing cells); SwatchTriage fails with token, value and harness cells.
const run = spawnSync(
    'pnpm',
    ['exec', 'figma-qa', 'report', 'Swatch.figma', 'SwatchTriage.figma', '--host-browser', '--no-open', '--json'],
    { cwd: fixture, encoding: 'utf8' },
);
// Exit 1 is the failing story this needs; anything else means no usable results.
if (run.status !== 1) {
    throw new Error(`figma-qa report exited ${run.status}, expected 1:\n${run.stderr}`);
}
const stories = JSON.parse(run.stdout).stories.map((story) => {
    return story.storyId;
});
for (const id of [PASSING, FAILING]) {
    if (!stories.includes(id)) {
        throw new Error(`the run has no story ${id}: ${stories.join(', ')}`);
    }
}

mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
let server;
try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    const shot = async (locator, name) => {
        await locator.screenshot({ path: join(out, name), animations: 'disabled' });
        console.log(`wrote docs/assets/${name}`);
    };

    await page.goto(pathToFileURL(join(fixture, 'figma-qa/.results/report/index.html')).href);
    await page.screenshot({ path: join(out, 'report-overview.png'), animations: 'disabled' });
    console.log('wrote docs/assets/report-overview.png');
    await shot(page.locator('.fqa-notice[data-kind="warning"]').first(), 'host-browser-banner.png');
    await shot(
        page.locator(`[data-story-id="${FAILING}"] .fqa-cell[data-status="fail"]`).first(),
        'report-failing-cell.png',
    );

    server = await serveDev(fixture);
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const [id, name] of [
        [PASSING, 'panel-pass.png'],
        [FAILING, 'panel-fail.png'],
    ]) {
        // No sidebar, panel dragged up to 3/5 of the page: the matrix on top, the panel wide enough for its table.
        await page.goto(`${server.url}/?path=/story/${id}&nav=false`);
        await page.getByRole('tab', { name: 'Figma diff' }).click({ timeout: 60_000 });
        // Rendered from the run's results, like the smoke check waits for.
        await page.locator(`[data-story-id="${id}"][data-verdict]`).waitFor({ timeout: 30_000 });
        await page.frameLocator('#storybook-preview-iframe').locator('[data-figma-variant]').first().waitFor();
        const tabs = await page.getByRole('tab', { name: 'Figma diff' }).boundingBox();
        await page.mouse.move(720, tabs.y - 4);
        await page.mouse.down();
        await page.mouse.move(720, 400, { steps: 10 });
        await page.mouse.up();
        await page.screenshot({ path: join(out, name), animations: 'disabled' });
        console.log(`wrote docs/assets/${name}`);
    }
} finally {
    await browser.close();
    server?.stop();
}
