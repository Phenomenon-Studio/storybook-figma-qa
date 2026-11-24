import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['test/**/*.test.ts'],
        testTimeout: 120_000,
        // Test files run reports in the same fixtures: results and synced refs are per fixture, so one file at a time.
        fileParallelism: false,
    },
});
