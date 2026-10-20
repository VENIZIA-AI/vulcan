import { buildServer } from '@/server';
import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** Two packages whose directories are both called `core`: told apart by their `dir` key and `path`. */
const project = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-same-directory-'));
  const files: Record<string, string> = {
    '.agents/vulcan.manifest.json': JSON.stringify({
      schemaVersion: 1,
      name: 'shop',
      packages: [
        {
          name: '@shop/umbras-core',
          dir: 'umbras-core',
          path: 'umbras/core',
          aliases: [],
          retired: false,
        },
        {
          name: '@shop/kits-core',
          dir: 'kits-core',
          path: 'auroras/kits/core',
          aliases: [],
          retired: false,
        },
      ],
      knowledge: { bundle: '.agents/knowledge' },
    }),
    '.agents/knowledge/index.md': '# Shop\n',
    'umbras/core/package.json': JSON.stringify({
      name: '@shop/umbras-core',
      version: '0.0.1-0',
      private: true,
      exports: { '.': { types: './dist/index.d.ts' } },
    }),
    'umbras/core/dist/index.d.ts': 'export declare function fromUmbras(): string;\n',
    'auroras/kits/core/package.json': JSON.stringify({
      name: '@shop/kits-core',
      version: '0.0.1-0',
      private: true,
      exports: { '.': { types: './dist/index.d.ts' } },
    }),
    'auroras/kits/core/dist/index.d.ts': 'export declare function fromKits(): string;\n',
  };

  roots.push(root);

  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }

  return root;
};

const callSymbol = async (opts: { root: string; name: string }) =>
  JSON.parse(
    (await buildServer({ root: opts.root, version: '0.0.0' }).handleLine({
      line: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'symbol', arguments: { name: opts.name } },
      }),
    })) ?? 'null',
  );

test('symbol answers from each of two packages whose directories are both called core', async () => {
  const root = project();
  const umbras = await callSymbol({ root, name: 'fromUmbras' });
  const kits = await callSymbol({ root, name: 'fromKits' });

  expect(umbras.result.content[0].text).toContain('@shop/umbras-core');
  expect(umbras.result.content[0].text).not.toContain('@shop/kits-core');
  expect(kits.result.content[0].text).toContain('@shop/kits-core');
  expect(kits.result.content[0].text).not.toContain('@shop/umbras-core');
});
