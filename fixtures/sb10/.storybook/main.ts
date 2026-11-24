import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
    framework: '@storybook/react-vite',
    stories: ['../src/**/*.stories.@(ts|tsx)'],
    // As `figma-qa init` writes it; test/init-cli.test.ts strips the kit from a copy and re-runs init.
    addons: ['@phenomenon-studio/storybook-figma-qa'],
};

export default config;
