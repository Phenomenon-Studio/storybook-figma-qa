import { figmaQa } from '@phenomenon-studio/storybook-figma-qa/vitest';
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(viteConfig, defineConfig({ test: { projects: [figmaQa()] } }));
