import type { TestProjectInlineConfiguration } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import { BROWSER_WS_ENV, FIGMA_PROJECT } from './constants.ts';
import { FIGMA_SCALE, FIGMA_TAG } from './figma/types.ts';
import { figmaEnsureSets, figmaPixelDiff, figmaSaveStoryResult } from './node/commands.ts';

/**
 * The browser page. Vitest 4 scales the story iframe down to fit the page, and screenshots then come out smaller than
 * Figma's export; addon-vitest sizes that iframe to 1200×900 by default, so the page is larger than that.
 */
const PAGE = { width: 1600, height: 1200 };

/**
 * The Figma Vitest project: `test: { projects: [figmaQa()] }`. Runs `figma`-tagged stories in Chromium at Figma's
 * export scale and holds each matrix cell to its Figma variant (setup.ts).
 */
export function figmaQa(): TestProjectInlineConfiguration {
    const provider = playwright({
        contextOptions: { deviceScaleFactor: FIGMA_SCALE, viewport: PAGE },
        // Read when the provider opens the browser, not here: `figma-qa report` starts the pinned image only once
        // collect has found a story to run, after this config loaded. The image runs in a container: `<loopback>`
        // tunnels its requests for Vitest's localhost server back through this process.
        get connectOptions() {
            const wsEndpoint = process.env[BROWSER_WS_ENV];

            return wsEndpoint ? { wsEndpoint, exposeNetwork: '<loopback>' } : undefined;
        },
    });
    // Vitest 5 prewarms host Chromium while the config loads, before the report knows which browser runs.
    const { prewarm: _prewarm, ...lazyProvider } = provider as typeof provider & { prewarm?: unknown };

    return {
        extends: true,
        plugins: [
            storybookTest({
                configDir: path.resolve('.storybook'),
                tags: { include: [FIGMA_TAG], exclude: [], skip: [] },
            }),
        ],
        test: {
            name: FIGMA_PROJECT,
            // Built next to this file; resolved from the package so it works from node_modules.
            setupFiles: [fileURLToPath(new URL('./setup.js', import.meta.url))],
            // Every cell of a story is checked in one afterEach.
            hookTimeout: 300_000,
            browser: {
                enabled: true,
                headless: true,
                // Figma refs are 2x exports, so the page renders at the same device scale.
                provider: lazyProvider,
                instances: [{ browser: 'chromium' }],
                screenshotFailures: false,
                commands: { figmaEnsureSets, figmaPixelDiff, figmaSaveStoryResult },
            },
        },
    };
}
