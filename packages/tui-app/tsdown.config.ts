import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/surface.ts'],
  format: 'esm',
  dts: true,
  clean: true,
  fixedExtension: true,
});