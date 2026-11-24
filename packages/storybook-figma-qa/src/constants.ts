export const ADDON_ID = 'phenomenon-studio/storybook-figma-qa';
export const PANEL_ID = `${ADDON_ID}/panel`;
export const PANEL_TITLE = 'Figma diff';
/** Preview global the panel flips to switch a Figma story's compare overlay. */
export const COMPARE_GLOBAL = 'figmaCompare';
/** Vitest project name of the Figma checks; `figma-qa report` runs only this project. */
export const FIGMA_PROJECT = 'figma-qa';
/** Set by `figma-qa report --refresh` for the in-process browser commands: adopt the current Figma version. */
export const REFRESH_ENV = 'FIGMA_QA_REFRESH';
/**
 * Dev-only route a running Storybook serves (node/vite-plugin.ts): `${DEV_ROUTE}/files/<project path>` reads run results
 * and refs for the panel; `POST ${DEV_ROUTE}/sets` loads a Figma story's sets for the matrix.
 */
export const DEV_ROUTE = '/__figma-qa';
/**
 * Set by `figma-qa report` when the pinned browser image runs: `figmaQa()` connects to this Playwright server instead
 * of launching the host's Chromium. Under `--ci` the workflow sets it to its browser service container.
 */
export const BROWSER_WS_ENV = 'FIGMA_QA_BROWSER_WS';
/** Host port of the pinned browser's Playwright server; tests move it off the default. */
export const BROWSER_PORT_ENV = 'FIGMA_QA_BROWSER_PORT';
export const BROWSER_PORT = 3100;
/** Provided to the Figma project's browser by `figma-qa report` for story-id filters: an `IdSelection`. */
export const STORIES_KEY = 'figmaQaStories';
/** The package `.storybook/main` lists in `addons` to load the kit's preset, manager and preview. */
export const PACKAGE_NAME = '@phenomenon-studio/storybook-figma-qa';
