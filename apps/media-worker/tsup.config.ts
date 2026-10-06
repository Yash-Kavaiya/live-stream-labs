import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  target: 'node22',
  clean: true,
  // The shared package ships TypeScript source, so it is bundled; npm packages stay external.
  noExternal: ['@studio/shared'],
});
