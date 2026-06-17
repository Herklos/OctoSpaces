import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Two projects: pure-logic suites run in a fast node env; component-render
    // suites (`*.test.tsx`) run in jsdom with `react-native` aliased to
    // `react-native-web` so RN primitives render to the DOM and can be queried
    // with @testing-library/react.
    projects: [
      {
        test: {
          name: 'logic',
          environment: 'node',
          globals: false,
          include: ['src/**/*.test.ts'],
        },
      },
      {
        define: { __DEV__: 'true' },
        esbuild: { jsx: 'automatic' },
        resolve: {
          alias: { 'react-native': 'react-native-web' },
        },
        test: {
          name: 'components',
          environment: 'jsdom',
          globals: false,
          include: ['src/**/*.test.tsx'],
          setupFiles: ['./vitest.setup.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/index.ts',
        'src/test/**',
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
