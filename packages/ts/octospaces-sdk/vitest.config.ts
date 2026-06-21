import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    // Run serially — some tests share module-level singletons (member-caps cache).
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Tests live under tests/ (outside the coverage include); only entry
      // points need excluding from the src/ source set.
      exclude: [
        'src/index.ts',
        // WAL subpath wiring — thin Starfish adapters, integration-wired (no unit tests).
        'src/wal/**',
      ],
      thresholds: {
        // Overall floor — raise as test coverage improves.
        lines:      65,
        branches:   60,
        functions:  65,
        statements: 65,
        // Security-sensitive modules: higher bar.
        'src/sync/account-seal.ts':          { lines: 85, branches: 80, functions: 90, statements: 85 },
        'src/sync/node-keyring.ts':          { lines: 85, branches: 80, functions: 90, statements: 85 },
        'src/spaces/resource-requests.ts':   { lines: 80, branches: 75, functions: 80, statements: 80 },
        'src/spaces/members.ts':             { lines: 80, branches: 75, functions: 80, statements: 80 },
        'src/spaces/nodes.ts':               { lines: 75, branches: 70, functions: 75, statements: 75 },
        'src/sync/client.ts':                { lines: 75, branches: 70, functions: 75, statements: 75 },
      },
    },
  },
});
