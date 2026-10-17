import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  cachedSymbols,
  symbolsCacheDirectory,
  symbolsOfInstalled,
  symbolsOfPublished,
} from '@/symbols';
import { restoreVariable } from '../env.helper';

const roots: string[] = [];
const previous = { cache: process.env.XDG_CACHE_HOME, registry: process.env.VULCAN_NPM_REGISTRY };

const temp = (opts: { prefix: string }): string => {
  const root = mkdtempSync(join(tmpdir(), opts.prefix));

  roots.push(root);

  return root;
};

const write = (opts: { root: string; files: Record<string, string> }): void => {
  for (const [path, text] of Object.entries(opts.files)) {
    mkdirSync(dirname(join(opts.root, path)), { recursive: true });
    writeFileSync(join(opts.root, path), text);
  }
};

/** A published package as npm unpacks it: its manifest, its exports, its declaration file. */
const KIT = {
  'package.json': JSON.stringify({
    name: '@x/kit',
    version: '1.2.0',
    exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
  }),
  'dist/index.d.ts':
    'export declare function greet(name: string): string;\nexport declare class Kit {\n  run(): void;\n}\n',
};

beforeEach(() => {
  process.env.XDG_CACHE_HOME = temp({ prefix: 'atlas-symbols-cache-' });
});

afterEach(() => {
  restoreVariable({ name: 'XDG_CACHE_HOME', value: previous.cache });
  restoreVariable({ name: 'VULCAN_NPM_REGISTRY', value: previous.registry });
});

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('symbolsOfInstalled (D2)', () => {
  test("reads the installed package's own declarations - the version the consumer runs", () => {
    const consumer = temp({ prefix: 'atlas-consumer-' });

    write({ root: join(consumer, 'node_modules/@x/kit'), files: KIT });

    const symbols = symbolsOfInstalled({ directory: join(consumer, 'node_modules/@x/kit') });

    expect(symbols.map(symbol => `${symbol.package} ${symbol.name} ${symbol.kind}`).sort()).toEqual(
      ['@x/kit Kit class', '@x/kit greet function'],
    );
    expect(symbols.find(symbol => symbol.name === 'greet')?.signature).toContain(
      'greet(name: string): string',
    );
  });

  test('an export whose declaration file is missing is skipped with one warning; the others still answer', () => {
    const consumer = temp({ prefix: 'atlas-consumer-' });
    const directory = join(consumer, 'node_modules/@x/kit');
    const warnSpy = spyOn(console, 'error').mockImplementation(() => undefined);

    write({
      root: directory,
      files: {
        ...KIT,
        'package.json': JSON.stringify({
          name: '@x/kit',
          version: '1.3.0',
          exports: {
            '.': { types: './dist/index.d.ts' },
            './contracts': { types: './dist/contracts/index.d.ts' },
          },
        }),
      },
    });

    try {
      const symbols = symbolsOfInstalled({ directory });
      const warnings = warnSpy.mock.calls.map(call => String(call[0]));

      expect(symbols.map(symbol => symbol.name).sort()).toEqual(['Kit', 'greet']);
      expect(warnings.filter(line => line.includes('./contracts'))).toEqual([
        '[AtlasSymbols-recordsOf] skipped an export whose declaration file is missing | package: @x/kit | subpath: ./contracts | path: dist/contracts/index.d.ts',
      ]);
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('cached by name@version, forever: the second read needs no declarations (positive control)', () => {
    const consumer = temp({ prefix: 'atlas-consumer-' });
    const directory = join(consumer, 'node_modules/@x/kit');

    write({ root: directory, files: KIT });
    symbolsOfInstalled({ directory });
    rmSync(join(directory, 'dist'), { recursive: true });

    expect(existsSync(join(symbolsCacheDirectory(), '@x+kit@1.2.0.json'))).toBe(true);
    expect(
      symbolsOfInstalled({ directory })
        .map(symbol => symbol.name)
        .sort(),
    ).toEqual(['Kit', 'greet']);
  });
});

describe('the symbols cache', () => {
  test('two valid names never share a cache file', () => {
    const consumer = temp({ prefix: 'atlas-consumer-' });

    for (const name of ['@a/b__c', '@a__b/c']) {
      write({
        root: join(consumer, 'node_modules', name),
        files: {
          ...KIT,
          'package.json': JSON.stringify({ ...JSON.parse(KIT['package.json']), name }),
        },
      });
      symbolsOfInstalled({ directory: join(consumer, 'node_modules', name) });
    }

    expect(cachedSymbols({ name: '@a/b__c', version: '1.2.0' })?.[0]?.package).toBe('@a/b__c');
    expect(cachedSymbols({ name: '@a__b/c', version: '1.2.0' })?.[0]?.package).toBe('@a__b/c');
  });

  test('a name or a version that could leave the cache directory is refused', async () => {
    expect(() => cachedSymbols({ name: '../../escape', version: '1.0.0' })).toThrow(
      "atlas: '../../escape' is not an npm package name",
    );
    expect(() => cachedSymbols({ name: '@x/kit', version: '1.0.0/../../escape' })).toThrow(
      "atlas: '1.0.0/../../escape' is not a version",
    );
    expect(
      String(
        await symbolsOfPublished({ name: '@x/kit', version: '1.0.0/../x' }).catch(
          (error: unknown) => error,
        ),
      ),
    ).toContain("atlas: '1.0.0/../x' is not a version");
  });
});

describe('symbolsOfPublished (D2)', () => {
  test('not installed: the npm tarball of that version, unpacked once and cached', async () => {
    const packed = temp({ prefix: 'atlas-tarball-' });

    write({ root: join(packed, 'package'), files: KIT });
    execFileSync('tar', ['-czf', join(packed, 'kit-1.2.0.tgz'), '-C', packed, 'package']);

    let served = 0;
    const registry = Bun.serve({
      port: 0,
      fetch: request => {
        served += 1;

        return new URL(request.url).pathname === '/@x/kit/-/kit-1.2.0.tgz'
          ? new Response(Bun.file(join(packed, 'kit-1.2.0.tgz')))
          : new Response('not found', { status: 404 });
      },
    });

    process.env.VULCAN_NPM_REGISTRY = `http://localhost:${registry.port}`;

    try {
      const first = await symbolsOfPublished({ name: '@x/kit', version: '1.2.0' });
      const second = await symbolsOfPublished({ name: '@x/kit', version: '1.2.0' });

      expect(first.map(symbol => symbol.name).sort()).toEqual(['Kit', 'greet']);
      expect(second).toEqual(first);
      expect(served).toBe(1);
    } finally {
      await registry.stop(true);
    }
  });

  test('a version npm does not have answers no symbols, and says why', async () => {
    const registry = Bun.serve({
      port: 0,
      fetch: () => new Response('not found', { status: 404 }),
    });

    process.env.VULCAN_NPM_REGISTRY = `http://localhost:${registry.port}`;

    try {
      const failure = await symbolsOfPublished({ name: '@x/kit', version: '9.9.9' }).then(
        () => undefined,
        (error: unknown) => error,
      );

      expect(String(failure)).toContain('atlas: no npm tarball for @x/kit@9.9.9 (404)');
    } finally {
      await registry.stop(true);
    }
  });
});
