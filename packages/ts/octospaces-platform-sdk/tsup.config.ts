import { defineConfig } from 'tsup';

const NATIVE_EXTERNALS = [
  'react-native-quick-crypto',
  '@react-native-async-storage/async-storage',
  'expo-secure-store',
];

const PEER_EXTERNALS = [
  '@drakkar.software/octospaces-sdk',
  '@drakkar.software/starfish-identities',
  '@drakkar.software/starfish-protocol',
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
    external: PEER_EXTERNALS,
  },
  {
    entry: { 'index.native': 'src/index.native.ts' },
    format: ['esm'],
    dts: true,
    splitting: false,
    sourcemap: true,
    target: 'es2020',
    outDir: 'dist',
    external: [...PEER_EXTERNALS, ...NATIVE_EXTERNALS],
    noExternal: [],
  },
  {
    entry: { 'hash-wasm-shim': 'src/hash-wasm-shim.ts' },
    format: ['esm'],
    dts: true,
    splitting: false,
    sourcemap: true,
    target: 'es2020',
    outDir: 'dist',
  },
]);
