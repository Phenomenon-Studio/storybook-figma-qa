// Served by the kit's Vite plugin (node/vite-plugin.ts).

declare module 'virtual:figma-qa/config' {
    /** The project's `figma-qa.config.ts` default export; undefined when the project has none. */
    const config: unknown;
    export default config;
}

declare module 'virtual:figma-qa/icons' {
    /** Raw SVG source per file matched by `icons.glob`, keyed by root-relative path (`/src/icons/star.svg`). */
    const icons: Record<string, string>;
    export default icons;
}
