import { defineConfig } from 'tsdown';

export default defineConfig({
  // The PTC and search workers are standalone spawn-only entries: keyed
  // entries pin the output names (dist/index.mjs, dist/worker.mjs,
  // dist/search-worker.mjs) that the hosts' `new URL('./worker.mjs',
  // import.meta.url)` resolution depends on.
  entry: { index: 'src/index.ts', worker: 'src/ptc/worker.ts', 'search-worker': 'src/builtin/search-worker.ts' },
  format: 'esm',
  dts: true,
  clean: true,
  fixedExtension: true,
});
