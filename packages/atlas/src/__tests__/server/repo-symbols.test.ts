import { buildServer } from '@/server';
import { afterAll, expect, spyOn, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** A project in an application's shape: its one package outside packages/, built or not. */
const project = (opts: { built: boolean; exports?: Record<string, { types: string }> }): string => {
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
      exports: opts.exports ?? { '.': { types: './dist/index.d.ts' } },
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

test('one export whose .d.ts is missing is skipped with a warning; the built entries still answer', async () => {
  const warnSpy = spyOn(console, 'error').mockImplementation(() => undefined);
  const root = project({
    built: true,
    exports: {
      '.': { types: './dist/index.d.ts' },
      './contracts': { types: './dist/contracts/index.d.ts' },
    },
  });

  try {
    const reply = await callSymbol({ root, name: 'greet' });
    const warnings = warnSpy.mock.calls.map((call) => String(call[0]));

    expect(reply.error).toBeUndefined();
    expect(reply.result.content[0].text).toContain('greet(name: string): string');
    expect(warnings.filter((line) => line.includes('./contracts'))).toEqual([
      '[AtlasSymbols-recordsOf] skipped an export whose declaration file is missing | package: @shop/kit | subpath: ./contracts | path: umbras/kit/dist/contracts/index.d.ts',
    ]);
  } finally {
    warnSpy.mockRestore();
  }
});

test('one export whose .d.ts cannot be read as a module is skipped too; the others still answer', async () => {
  const warnSpy = spyOn(console, 'error').mockImplementation(() => undefined);
  const root = project({
    built: true,
    exports: {
      '.': { types: './dist/index.d.ts' },
      './globals': { types: './dist/globals.d.ts' },
    },
  });

  // A script, not a module: no import or export, so it has no module symbol to read.
  writeFileSync(join(root, 'umbras/kit/dist/globals.d.ts'), 'declare const BUILD_ID: string;\n');

  try {
    const reply = await callSymbol({ root, name: 'greet' });
    const warnings = warnSpy.mock.calls.map((call) => String(call[0]));

    expect(reply.error).toBeUndefined();
    expect(reply.result.content[0].text).toContain('greet(name: string): string');
    expect(
      warnings.some((line) => line.includes('./globals') && line.includes('could not be read')),
    ).toBe(true);
  } finally {
    warnSpy.mockRestore();
  }
});

test('an unbuilt project says to build first', async () => {
  const reply = await callSymbol({ root: project({ built: false }), name: 'greet' });

  expect(reply.error.message).toContain('no symbols - build the packages first');
});

test('built after the first question, the next one finds the symbol - the store loads again', async () => {
  const root = project({ built: false });
  const server = buildServer({ root, version: '0.0.0' });
  const ask = async () =>
    JSON.parse(
      (await server.handleLine({
        line: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'symbol', arguments: { name: 'greet' } },
        }),
      })) ?? 'null',
    );

  expect((await ask()).error.message).toContain('no symbols - build the packages first');

  mkdirSync(join(root, 'umbras/kit/dist'), { recursive: true });
  writeFileSync(
    join(root, 'umbras/kit/dist/index.d.ts'),
    'export declare function greet(name: string): string;\n',
  );

  const again = await ask();

  expect(again.error).toBeUndefined();
  expect(again.result.content[0].text).toContain('greet(name: string): string');
});

test('a rebuild that changes a signature is seen without a restart - the store follows the .d.ts (D2)', async () => {
  const root = project({ built: true });
  const server = buildServer({ root, version: '0.0.0' });
  const ask = async () =>
    JSON.parse(
      (await server.handleLine({
        line: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'symbol', arguments: { name: 'greet' } },
        }),
      })) ?? 'null',
    );

  expect((await ask()).result.content[0].text).toContain('greet(name: string): string');

  const declarations = join(root, 'umbras/kit/dist/index.d.ts');

  writeFileSync(
    declarations,
    'export declare function greet(name: string, loud: boolean): string;\n',
  );
  // A rebuild inside the same second must still be seen: the size changed as well.
  utimesSync(declarations, new Date(), new Date(Date.now() + 60_000));

  const after = await ask();

  expect(after.error).toBeUndefined();
  expect(after.result.content[0].text).toContain('greet(name: string, loud: boolean): string');
});
