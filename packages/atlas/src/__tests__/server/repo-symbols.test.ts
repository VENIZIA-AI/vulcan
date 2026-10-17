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

/** A project in an application's shape: its one package outside packages/, built or not. */
const project = (opts: { built: boolean }): string => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-repo-symbols-'));
  const files: Record<string, string> = {
    '.agents/vulcan.manifest.json': JSON.stringify({
      schemaVersion: 1,
      name: 'shop',
      packages: [
        { name: '@shop/kit', dir: 'kit', path: 'umbras/kit', aliases: [], retired: false },
      ],
      knowledge: { bundle: '.agents/knowledge' },
    }),
    '.agents/knowledge/index.md': '# Shop\n',
    'umbras/kit/package.json': JSON.stringify({
      name: '@shop/kit',
      version: '0.0.1-0',
      private: true,
      exports: { '.': { types: './dist/index.d.ts' } },
    }),
  };

  if (opts.built) {
    files['umbras/kit/dist/index.d.ts'] = 'export declare function greet(name: string): string;\n';
  }

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

test("repo mode answers symbol from the project's built declarations - no symbols.json", async () => {
  const reply = await callSymbol({ root: project({ built: true }), name: 'greet' });

  expect(reply.error).toBeUndefined();
  expect(reply.result.content[0].text).toContain('greet(name: string): string');
  expect(reply.result.content[0].text).toContain('@shop/kit');
});

test('an unbuilt project says to build first', async () => {
  const reply = await callSymbol({ root: project({ built: false }), name: 'greet' });

  expect(reply.error.message).toContain('no symbols - build the packages first');
});
