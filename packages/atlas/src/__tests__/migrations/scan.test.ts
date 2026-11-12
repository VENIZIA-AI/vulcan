import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { AppScan } from '@/migrations';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const appWith = (opts: { files: Record<string, string> }): string => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-scan-'));

  roots.push(root);

  for (const [path, text] of Object.entries(opts.files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }

  return root;
};

const lines = (opts: { app: string; symbols: string[]; packages?: string[] }): string[] =>
  AppScan.scan({
    app: opts.app,
    targets: [{ id: 't', packages: opts.packages ?? ['@a/kernel'], symbols: opts.symbols }],
  }).t.map((touch) => `${touch.file}:${touch.line}:${touch.symbol}`);

describe('AppScan.scan', () => {
  test('C10.1: an import and every use of a named symbol are reported with file and line', () => {
    const app = appWith({
      files: {
        'src/a.ts': "import { Thing } from '@a/kernel';\n\nconst a = Thing;\nnew Thing();\n",
      },
    });

    expect(lines({ app, symbols: ['Thing'] })).toEqual([
      'src/a.ts:1:Thing',
      'src/a.ts:3:Thing',
      'src/a.ts:4:Thing',
    ]);
  });

  test('C10.1: an alias is followed to its uses', () => {
    const app = appWith({
      files: { 'a.ts': "import { Thing as T } from '@a/kernel';\n\nT.make();\n" },
    });

    expect(lines({ app, symbols: ['Thing'] })).toEqual(['a.ts:1:Thing', 'a.ts:3:Thing']);
  });

  test('C10.2: Name.member is matched only through the import binding, at the member use', () => {
    const app = appWith({
      files: {
        'a.ts':
          "import { Thing } from '@a/kernel';\n\nThing.make();\nThing.other();\nconst Local = { make() {} };\nLocal.make();\n",
      },
    });

    expect(lines({ app, symbols: ['Thing.make'] })).toEqual(['a.ts:3:Thing.make']);
  });

  test('C10.2: `import type` and a re-export are reported at their own line', () => {
    const app = appWith({
      files: {
        'a.ts': "import type { Thing } from '@a/kernel';\n\nlet x: Thing;\n",
        'b.ts': "export { Thing } from '@a/kernel';\n",
        'c.ts': "export { Thing as Renamed } from '@a/kernel/sub';\n",
      },
    });

    expect(lines({ app, symbols: ['Thing'] }).sort()).toEqual([
      'a.ts:1:Thing',
      'a.ts:3:Thing',
      'b.ts:1:Thing',
      'c.ts:1:Thing',
    ]);
  });

  test('C10.2: a namespace import reaches the symbol and its member', () => {
    const app = appWith({
      files: { 'a.ts': "import * as k from '@a/kernel';\n\nk.Thing.make();\nk.Other();\n" },
    });

    expect(lines({ app, symbols: ['Thing'] })).toEqual(['a.ts:3:Thing']);
    expect(lines({ app, symbols: ['Thing.make'] })).toEqual(['a.ts:3:Thing.make']);
  });

  test('a module specifier symbol matches imports, re-exports and string `import()` of it', () => {
    const app = appWith({
      files: {
        'a.ts': "import { X } from '@a/kernel/helpers';\n",
        'b.ts': "export * from '@a/kernel/helpers';\n",
        'c.ts': "const m = await import('@a/kernel/helpers');\n",
        'd.ts': "import { Y } from '@a/kernel/other';\n",
      },
    });

    expect(lines({ app, symbols: ['@a/kernel/helpers'] }).sort()).toEqual([
      'a.ts:1:@a/kernel/helpers',
      'b.ts:1:@a/kernel/helpers',
      'c.ts:1:@a/kernel/helpers',
    ]);
  });

  test('a name that is not imported from the named package is not a touch', () => {
    const app = appWith({
      files: {
        'a.ts': "import { Thing } from './local';\n\nThing.make();\n",
        'b.ts': "import { Thing } from '@z/other';\n\nThing.make();\n",
      },
    });

    expect(lines({ app, symbols: ['Thing', 'Thing.make'] })).toEqual([]);
  });

  test('node_modules, dist and dot folders are not scanned; tsx, mts and js are', () => {
    const app = appWith({
      files: {
        'node_modules/x/a.ts': "import { Thing } from '@a/kernel';\n",
        'dist/a.js': "import { Thing } from '@a/kernel';\n",
        '.agents/a.ts': "import { Thing } from '@a/kernel';\n",
        'src/b.tsx': "import { Thing } from '@a/kernel';\n",
        'src/c.mts': "import { Thing } from '@a/kernel';\n",
        'src/d.js': "import { Thing } from '@a/kernel';\n",
        'src/e.md': "import { Thing } from '@a/kernel';\n",
      },
    });

    expect(lines({ app, symbols: ['Thing'] }).sort()).toEqual([
      'src/b.tsx:1:Thing',
      'src/c.mts:1:Thing',
      'src/d.js:1:Thing',
    ]);
  });

  test('two targets are answered apart, and a target with no touch holds an empty list', () => {
    const app = appWith({ files: { 'a.ts': "import { Thing } from '@a/kernel';\n" } });
    const found = AppScan.scan({
      app,
      targets: [
        { id: 'one', packages: ['@a/kernel'], symbols: ['Thing'] },
        { id: 'two', packages: ['@a/kernel'], symbols: ['Gone'] },
      ],
    });

    expect(found.one).toHaveLength(1);
    expect(found.two).toEqual([]);
  });
});
