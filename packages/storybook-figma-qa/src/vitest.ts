import type { Plugin } from 'vite';

/** Vitest plugin: will add the Figma browser commands and the Figma project around `storybookTest()`. */
export function figmaQa(): Plugin {
    return { name: 'storybook-figma-qa' };
}
