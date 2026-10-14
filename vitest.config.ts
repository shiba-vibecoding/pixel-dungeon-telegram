import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    // Shattered's levels are bigger and take longer to make: tests that make many of them, run side by
    // side with the rest, need more than the default five seconds.
    testTimeout: 30_000,
  },
});
