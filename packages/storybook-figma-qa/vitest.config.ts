import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        projects: [
            {
                test: {
                    name: 'cli',
                    include: ['test/**/*.test.ts'],
                    testTimeout: 120_000,
                    // Test files run reports in the same fixtures: results and synced refs are per fixture, so one file at a time.
                    fileParallelism: false,
                },
            },
            {
                // The results UI's stories (.storybook), with play functions and axe.
                plugins: [storybookTest({ configDir: '.storybook' })],
                test: {
                    name: 'ui',
                    browser: {
                        enabled: true,
                        headless: true,
                        provider: playwright(),
                        instances: [{ browser: 'chromium' }],
                    },
                },
            },
        ],
    },
});
