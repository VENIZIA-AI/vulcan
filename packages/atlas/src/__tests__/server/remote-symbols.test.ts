import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ProjectConfig } from '@/common/project-config';
import { RemoteSymbols } from '@/server/remote-symbols';
import { SymbolCompute } from '@/symbols';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const temp = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-remote-symbols-'));

  roots.push(root);

  return root;
};

const write = (opts: { root: string; files: Record<string, string> }): void => {
  for (const [path, text] of Object.entries(opts.files)) {
    mkdirSync(dirname(join(opts.root, path)), { recursive: true });
    writeFileSync(join(opts.root, path), text);
  }
};

/** A built package: its manifest and one declaration file, in which `greet` has `signature`. */
const kit = (opts: { version: string; signature: string }): Record<string, string> => ({
  'package.json': JSON.stringify({
    name: '@x/kit',
    version: opts.version,
    exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
  }),
  'dist/index.d.ts': `export declare function greet(${opts.signature}): string;\n`,
});

/** What the source project (the one atlas reads, ignis for a consumer) declares. */
const sourceProject = () =>
  ProjectConfig.toAtlasProject({
    root: temp(),
    manifest: {
      schemaVersion: 1,
      packages: [{ name: '@x/kit', dir: 'kit', aliases: [], retired: false }],
      knowledge: {},
      release: { tagPattern: '<dir>-v<version>', ignoreTags: [] },
    },
  });

const open = (opts: { cwd: string; newest?: string }) => {
  const cacheBase = temp();

  return {
    cacheBase,
    store: RemoteSymbols.storeOf({
      project: sourceProject(),
      cwd: opts.cwd,
      cacheBase,
      releases: {
        newestOf: () => (opts.newest === undefined ? undefined : { version: opts.newest }),
      },
      packageMap: [{ dir: 'kit', name: '@x/kit', aliases: [] }],
    }),
  };
};

describe('the symbols of a remote source follow the package the app has installed', () => {
  test('a version installed after the server started is read on the next question', () => {
    const cwd = temp();

    write({
      root: join(cwd, 'node_modules/@x/kit'),
      files: kit({ version: '1.0.0', signature: 'name: any' }),
    });

    const { store } = open({ cwd });

    expect(store.lookup({ name: 'greet' })[0].signature).toContain('name: any');

    // the install changes while the server runs: a new version, a new declaration
    rmSync(join(cwd, 'node_modules/@x/kit'), { recursive: true });
    write({
      root: join(cwd, 'node_modules/@x/kit'),
      files: kit({ version: '1.1.0', signature: 'name: string' }),
    });

    const found = store.lookup({ name: 'greet' });

    expect(found).toHaveLength(1);
    expect(found[0].signature).toContain('name: string');
    expect(found[0].signature).not.toContain('any');
  });

  test('an unchanged install is not read again', () => {
    const cwd = temp();

    write({
      root: join(cwd, 'node_modules/@x/kit'),
      files: kit({ version: '1.0.0', signature: 'name: string' }),
    });

    const { store } = open({ cwd });
    const first = store.lookup({ name: 'greet' })[0];

    expect(store.lookup({ name: 'greet' })[0]).toBe(first);
  });

  test('a stale entry of the package store beside the real link is never read', () => {
    const cwd = temp();
    const stale = join(cwd, 'node_modules/.bun/@x+kit@0.9.0/node_modules/@x/kit');
    const current = join(cwd, 'node_modules/.bun/@x+kit@1.2.0/node_modules/@x/kit');

    write({ root: stale, files: kit({ version: '0.9.0', signature: 'name: any' }) });
    write({ root: current, files: kit({ version: '1.2.0', signature: 'name: string' }) });
    mkdirSync(join(cwd, 'node_modules/@x'), { recursive: true });
    symlinkSync(current, join(cwd, 'node_modules/@x/kit'));
    // a throwaway tree that holds an older install
    write({
      root: join(cwd, '.agents/tmp/probe/node_modules/@x/kit'),
      files: kit({ version: '0.8.0', signature: 'name: any' }),
    });

    const [record] = open({ cwd }).store.lookup({ name: 'greet' });

    expect(record.signature).toContain('name: string');
    expect(record.origin?.version).toBe('1.2.0');
  });

  test('a hit names the version and the folder it was read from', () => {
    const cwd = temp();

    write({
      root: join(cwd, 'node_modules/@x/kit'),
      files: kit({ version: '1.0.0', signature: 'name: string' }),
    });

    const [record] = open({ cwd }).store.lookup({ name: 'greet' });

    expect(record.origin).toEqual({ version: '1.0.0', installedAt: 'node_modules/@x/kit' });
  });

  test('with nothing installed the newest release npm published answers, and says so', () => {
    const cwd = temp();
    const { store, cacheBase } = open({ cwd, newest: '2.0.0' });

    // what the pull cached for the newest release
    const published = temp();

    write({ root: published, files: kit({ version: '2.0.0', signature: 'name: unknown' }) });
    SymbolCompute.symbolsOfInstalled({ directory: published, cacheBase });

    const [record] = store.lookup({ name: 'greet' });

    expect(record.signature).toContain('name: unknown');
    expect(record.origin).toEqual({ version: '2.0.0' });
  });
});
