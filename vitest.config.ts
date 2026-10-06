import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/*/src/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    // Starting the embedded database can take a while on a busy machine.
    hookTimeout: 60_000,
  },
});
