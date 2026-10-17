import { expect, test } from 'bun:test';
import { declarationEntriesOf } from '@/common/package-entries';

test('only export entries whose types are declaration files are read; css, json and js targets are skipped', () => {
  const entries = declarationEntriesOf({
    exports: {
      '.': { types: './dist/index.d.ts', import: './dist/index.js' },
      './esm': { types: './dist/esm.d.mts' },
      './cjs': './dist/cjs.d.cts',
      './styles.css': './dist/styles.css',
      './package.json': './package.json',
      './runtime': './dist/runtime.js',
      './untyped': { import: './dist/untyped.js' },
    },
  });

  expect(entries).toEqual([
    { subpath: '.', types: './dist/index.d.ts' },
    { subpath: './esm', types: './dist/esm.d.mts' },
    { subpath: './cjs', types: './dist/cjs.d.cts' },
  ]);
});
