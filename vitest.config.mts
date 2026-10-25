import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC is needed because esbuild doesn't emit decorator metadata, which Nest's DI relies on.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts', 'src/**/*.module.ts', 'src/testing/**', 'src/**/*.spec.ts'],
    },
  },
});
