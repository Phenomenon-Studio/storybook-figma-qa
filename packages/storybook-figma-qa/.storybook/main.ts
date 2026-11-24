// The kit's own Storybook: stories for the results UI (panel and HTML report) fed fixed results, run by the `ui`
// Vitest project with play functions and axe. Development only; nothing here ships.
import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
    framework: '@storybook/react-vite',
    stories: ['../stories/**/*.stories.tsx'],
    addons: ['@storybook/addon-a11y', '@storybook/addon-vitest'],
    staticDirs: [{ from: '../stories/images', to: '/images' }],
};

export default config;
