import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
    // Run serially — some tests share module-level singletons (member-caps cache).
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
