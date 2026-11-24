// `./config`: what a project's `figma-qa.config.ts` imports. Kept to the authoring surface; resolution and validation
// stay internal (figma/config.ts), so they can change without a major.
export { defineConfig, iconName } from './figma/config.ts';
export type { FigmaQaConfig, FigmaVariable } from './figma/config.ts';
