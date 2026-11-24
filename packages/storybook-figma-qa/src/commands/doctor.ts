// `figma-qa doctor`: setup checks, one line each. Exit 2 when a check blocks a run; warnings keep exit 0.
import { glob } from 'tinyglobby';
import { CONFIG_FILE } from '../figma/config.ts';
import { dockerRunning } from '../node/browser.ts';
import { loadProjectConfig } from '../node/config.ts';
import { addonBlocked, openFigmaProject } from '../node/figma-project.ts';

export async function doctor(): Promise<number> {
    const root = process.cwd();
    let loaded;
    try {
        loaded = await loadProjectConfig(root);
    } catch (error) {
        console.error(`figma-qa doctor: ${error instanceof Error ? error.message : String(error)}`);

        return 2;
    }
    const { file, config } = loaded;
    console.log(`ok    config: ${file ? CONFIG_FILE : `no ${CONFIG_FILE}, defaults apply`}`);
    // Same glob syntax Vite's `import.meta.glob` serves the preview (both use tinyglobby).
    const icons = await glob(config.icons.glob, { cwd: root });
    if (icons.length > 0) {
        console.log(`ok    icons: ${icons.length} match ${config.icons.glob}`);
    } else {
        console.log(`warn  icons: none match ${config.icons.glob}; Figma cells render without glyphs (set icons.glob)`);
    }
    // The same checks `report` blocks on: the kit wired into Storybook and Vitest.
    let blocked = await addonBlocked(root);
    if (!blocked) {
        try {
            const opened = await openFigmaProject(
                { reporters: [] },
                { stdout: process.stderr, stderr: process.stderr }
            );
            if ('blocked' in opened) {
                blocked = opened.blocked;
            } else {
                await opened.vitest.close();
            }
        } catch (error) {
            // A Vitest config that fails to load is a setup error (exit 2), never a crash.
            blocked = `Vitest config: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
    if (blocked) {
        console.log(`block setup: ${blocked}`);

        return 2;
    }
    console.log('ok    setup: kit addon in .storybook/main, figma-qa Vitest project');
    if (await dockerRunning()) {
        console.log('ok    browser: Docker runs; report starts the pinned browser image');
    } else {
        console.log('warn  browser: Docker is not running; report uses host Chromium (pixels not comparable to CI)');
    }
    console.log('figma-qa doctor: done');

    return 0;
}
