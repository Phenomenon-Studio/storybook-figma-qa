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
