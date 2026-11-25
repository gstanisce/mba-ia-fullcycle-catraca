import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // All test files share one Postgres database: run them serially.
    fileParallelism: false,
    globalSetup: ['test/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
