import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    // WAL wiring behind its own subpath so apps that don't use WAL
    // (e.g. OctoChat web) can exclude @drakkar.software/starfish-wal from their bundle.
    wal: 'src/wal/index.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  target: 'es2020',
});
