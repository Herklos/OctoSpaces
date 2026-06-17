import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/index.ts',
      ],
      thresholds: {
        // Conservative floor — most visual components lack tests.
        // Raise as component tests are added.
        lines:      30,
        branches:   25,
        functions:  30,
        statements: 30,
        // Pure-logic modules with existing tests: higher bar.
        'src/theme/helpers.ts':        { lines: 90, branches: 85, functions: 90, statements: 90 },
        'src/theme/tokens.ts':         { lines: 85, branches: 80, functions: 85, statements: 85 },
        'src/discover/filter.ts':      { lines: 90, branches: 85, functions: 90, statements: 90 },
        'src/sidebar/tile-state.ts':   { lines: 90, branches: 85, functions: 90, statements: 90 },
      },
    },
  },
});
