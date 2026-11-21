import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
    framework: '@storybook/react-vite',
    stories: ['../src/**/*.stories.@(ts|tsx)'],
    // Wired by hand; `figma-qa init` will do this merge for consumers.
    addons: ['@phenomenon-studio/storybook-figma-qa'],
};

export default config;
