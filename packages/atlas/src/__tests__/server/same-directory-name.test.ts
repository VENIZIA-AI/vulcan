import { buildRepositoryServer } from '../server.helper';
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
          name: '@shop/backends-core',
          dir: 'backends-core',
          path: 'backends/core',
          aliases: [],
          retired: false,
        },
        {
          name: '@shop/kits-core',
          dir: 'kits-core',
          path: 'frontends/kits/core',
          aliases: [],
          retired: false,
        },
      ],
      knowledge: { bundle: '.agents/knowledge' },
    }),
    '.agents/knowledge/index.md': '# Shop\n',
    'backends/core/package.json': JSON.stringify({
      name: '@shop/backends-core',
      version: '0.0.1-0',
      private: true,
      exports: { '.': { types: './dist/index.d.ts' } },
    }),
    'backends/core/dist/index.d.ts': 'export declare function fromBackends(): string;\n',
    'frontends/kits/core/package.json': JSON.stringify({
      name: '@shop/kits-core',
      version: '0.0.1-0',
      private: true,
      exports: { '.': { types: './dist/index.d.ts' } },
    }),
    'frontends/kits/core/dist/index.d.ts': 'export declare function fromKits(): string;\n',
  };

  roots.push(root);

  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }

  return root;
};

const callSymbol = async (opts: { root: string; name: string }) => {
  const line = await buildRepositoryServer({ root: opts.root, version: '0.0.0' }).handleLine({
    line: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'symbol', arguments: { name: opts.name } },
    }),
  });

  return JSON.parse(line ?? 'null');
};

test('symbol answers from each of two packages whose directories are both called core', async () => {
  const root = project();
  const backends = await callSymbol({ root, name: 'fromBackends' });
  const kits = await callSymbol({ root, name: 'fromKits' });

  expect(backends.result.content[0].text).toContain('@shop/backends-core');
  expect(backends.result.content[0].text).not.toContain('@shop/kits-core');
  expect(kits.result.content[0].text).toContain('@shop/kits-core');
  expect(kits.result.content[0].text).not.toContain('@shop/backends-core');
});
