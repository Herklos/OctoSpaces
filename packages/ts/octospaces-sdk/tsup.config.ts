import { defineConfig } from 'tsup';

// Deps that will never be present at SDK build time (native peer deps)
const NATIVE_EXTERNALS = [
  'react-native-quick-crypto',
  '@react-native-async-storage/async-storage',
];

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    dts: true,
    clean: true,
    splitting: false,
    sourcemap: true,
    target: 'es2020',
  },
  {
    entry: { 'platform/index': 'src/platform/index.ts' },
    format: ['esm'],
    dts: true,
    splitting: false,
    sourcemap: true,
    target: 'es2020',
    outDir: 'dist',
  },
  {
    entry: { 'platform/index.native': 'src/platform/index.native.ts' },
    format: ['esm'],
    dts: true,
    splitting: false,
    sourcemap: true,
    target: 'es2020',
    outDir: 'dist',
    external: NATIVE_EXTERNALS,
    // Do NOT resolve or bundle native platform deps — they are provided at runtime.
    noExternal: [],
  },
]);
