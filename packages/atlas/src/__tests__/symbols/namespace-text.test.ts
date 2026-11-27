import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ApiReference } from '@/api';
import { PackageEntries } from '@/common/package-entries';
import type { ISymbolRecord } from '@/symbols';
import { DeclarationText } from '@/symbols/declaration-text';
import { AtlasSymbols } from '@/symbols/generator';
import { NamespaceText } from '@/symbols/namespace-text';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * The records of a package that ships declaration files only, by name. `directory` puts the package below the
 * temporary folder, so a file named with `../` lies outside it.
 */
const recordsOf = (opts: {
  files: Record<string, string>;
  directory?: string;
  /** Symbolic links to make, by path: each value is the target, as written in the link. */
  links?: Record<string, string>;
}): Map<string, ISymbolRecord> => {
  const base = mkdtempSync(join(tmpdir(), 'atlas-namespace-'));
  const root = join(base, opts.directory ?? '');

  roots.push(base);

  const files: Record<string, string> = {
    'package.json': JSON.stringify({
      name: '@x/web',
      version: '1.0.0',
      exports: { '.': { types: './dist/index.d.ts' } },
    }),
    ...opts.files,
  };

  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }

  for (const [path, target] of Object.entries(opts.links ?? {})) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    symlinkSync(target, join(root, path));
  }

  const records = AtlasSymbols.recordsOf({
    repoRoot: root,
    packages: [PackageEntries.readDirectory({ directory: root })],
  });

  return new Map(records.map((record) => [record.name, record]));
};

const HTTP: Record<string, string> = {
  'dist/index.d.ts': [
    '/** Everything of HTTP. */',
    "export * as HTTP from './http/index.js';",
    "export * as Web from './http/index.js';",
    "import * as Local from './local.js';",
    "import * as Other from './local.js';",
    'export { Local, Other as Renamed };',
    '',
  ].join('\n'),
  'dist/http/index.d.ts': [
    "export * from './methods.js';",
    "export * as Status from './status.js';",
    '/** Reads a header. */',
    'export declare function header(name: string): string;',
    'export declare function header(name: number): number;',
    'declare const raw: 1;',
    'export { raw as renamed };',
    'export {};',
    '',
  ].join('\n'),
  'dist/http/methods.d.ts': [
    '/** The verbs. */',
    'export declare const Methods: {',
    '    /** Reads. */',
    '    readonly GET: "get";',
    '};',
    'export type TMethod = (typeof Methods)[keyof typeof Methods];',
    'interface IHidden {',
    '    held: boolean;',
    '}',
    'export declare const first: IHidden;',
    'export declare const second: IHidden;',
    'export {};',
    '',
  ].join('\n'),
  'dist/http/status.d.ts': [
    'export declare const OK: 200;',
    "export * as Back from './index.js';",
    '',
  ].join('\n'),
  'dist/local.d.ts': '/** Local one. */\nexport declare const one: 1;\n',
};

describe('a re-exported namespace', () => {
  const records = recordsOf({ files: HTTP });
  const declarationOf = (name: string): string => records.get(name)?.declaration ?? '';

  test('export * as lists each member with its type and TSDoc', () => {
    const text = declarationOf('HTTP');

    expect(text.startsWith('/** Everything of HTTP. */\nexport declare namespace HTTP {\n')).toBe(
      true,
    );
    expect(text).toContain(
      '    /** The verbs. */\n    const Methods: {\n        /** Reads. */\n        readonly GET: "get";\n    };',
    );
    expect(text).toContain('    type TMethod = (typeof Methods)[keyof typeof Methods];');
    expect(text).toContain(
      '    /** Reads a header. */\n    function header(name: string): string;',
    );
    expect(text).toContain('    function header(name: number): number;');
    expect(records.get('HTTP')?.doc).toBe('Everything of HTTP.');
    expect(records.get('HTTP')?.category).toBe('namespace');
    expect(records.get('HTTP')?.signature).toBe('namespace HTTP');
  });

  test('a member under another name says the name it is exported as', () => {
    expect(declarationOf('HTTP')).toContain('    // exported as `renamed`\n    const raw: 1;');
  });

  test('an unexported type two members use is shown once', () => {
    expect(declarationOf('HTTP').split('interface IHidden').length).toBe(2);
  });

  test('a nested namespace is listed inside, and a cycle back is named, not repeated', () => {
    const text = declarationOf('HTTP');

    expect(text).toContain(
      '    namespace Status {\n        // `Back`: the same members as `HTTP`\n        const OK: 200;\n    }',
    );
    expect(text.split('const OK: 200;').length).toBe(2);
  });

  test('import * as then export { X } and export { X as Y } are listed too', () => {
    for (const name of ['Local', 'Renamed']) {
      expect(declarationOf(name)).toContain(
        `export declare namespace ${name} {\n    /** Local one. */\n    const one: 1;\n}`,
      );
    }
  });

  test('a namespace exported twice has one shape, whatever its name', () => {
    expect(records.get('Web')?.shape).toBe(records.get('HTTP')?.shape);
    expect(records.get('Local')?.shape).not.toBe(records.get('HTTP')?.shape);
  });

  test('the names of its own members are not listed as used symbols', () => {
    expect(records.get('HTTP')?.uses).toEqual([]);
  });

  test('a changed member of a nested namespace moves the shape', () => {
    const changed = recordsOf({
      files: { ...HTTP, 'dist/http/status.d.ts': 'export declare const OK: 201;\n' },
    });

    expect(changed.get('HTTP')?.shape).not.toBe(records.get('HTTP')?.shape);
  });

  test('the API page shows the members, and TSDoc is not owed by the namespace', () => {
    const all = [...records.values()];
    const page = ApiReference.filesOf({ records: all }).get('x-web.md') ?? '';

    expect(page).toContain('const Methods: {');
    expect(ApiReference.undocumentedOf({ records: all })).toEqual([]);
  });
});

describe('a re-exported namespace that is large, deep or partly foreign', () => {
  test('a namespace too long for the entry page moves to a part, cut and marked past the cap', () => {
    const members = Array.from(
      { length: 900 },
      (_, at) => `/** Header ${at}. */\nexport declare const H${at}: "x-header-${at}";`,
    ).join('\n');
    const records = recordsOf({
      files: {
        'dist/index.d.ts':
          "export * as Headers from './headers.js';\nexport * as Methods from './methods.js';\n",
        'dist/headers.d.ts': `${members}\n`,
        'dist/methods.d.ts': 'export declare const GET: "get";\n',
      },
    });
    const declaration = records.get('Headers')?.declaration ?? '';
    const files = ApiReference.filesOf({ records: [...records.values()] });

    expect(declaration.length).toBeLessThanOrEqual(DeclarationText.RECORD_MAX_CHARS);
    expect(declaration.endsWith(DeclarationText.CUT_MARK)).toBe(true);

    const long = Array.from({ length: 2 }, () => records.get('Headers')).flatMap((record, at) =>
      record === undefined ? [] : [{ ...record, name: `${record.name}${at}`, line: at + 1 }],
    );

    expect([...ApiReference.filesOf({ records: long }).keys()]).toContain('x-web--part-2.md');
    expect(files.get('x-web.md')).toContain('## `Headers`');
  });

  test('nesting stops at the depth limit and says so', () => {
    const levels = NamespaceText.MAX_DEPTH + 2;
    const files = Object.fromEntries(
      Array.from({ length: levels }, (_, at) => [
        `dist/level${at}.d.ts`,
        at === levels - 1
          ? 'export declare const bottom: 1;\n'
          : `export * as Next from './level${at + 1}.js';\n`,
      ]),
    );
    const records = recordsOf({
      files: { ...files, 'dist/index.d.ts': "export * as Top from './level0.js';\n" },
    });
    const declaration = records.get('Top')?.declaration ?? '';

    expect(declaration).toContain('not listed: deeper than');
    expect(declaration).not.toContain('bottom');
  });

  test('a member of a third-party package is named only', () => {
    const records = recordsOf({
      files: {
        'dist/index.d.ts': "export * as Mixed from './mixed.js';\n",
        'dist/mixed.d.ts': "export { foreign } from 'dep';\nexport declare const own: 1;\n",
        'node_modules/dep/package.json': JSON.stringify({ name: 'dep', types: './index.d.ts' }),
        'node_modules/dep/index.d.ts': 'export declare const foreign: "SECRET_SHAPE";\n',
      },
    });
    const declaration = records.get('Mixed')?.declaration ?? '';

    expect(declaration).toContain('// `foreign`: re-exported from a third-party package');
    expect(declaration).not.toContain('SECRET_SHAPE');
    expect(declaration).toContain('const own: 1;');
  });

  test('a member of a hoisted dependency, outside the package folder, is named only', () => {
    const records = recordsOf({
      directory: 'node_modules/web',
      files: {
        'dist/index.d.ts':
          "export * as Mixed from './mixed.js';\nexport { foreign as direct } from 'dep';\n",
        'dist/mixed.d.ts': "export { foreign } from 'dep';\nexport declare const own: 1;\n",
        '../dep/package.json': JSON.stringify({ name: 'dep', types: './index.d.ts' }),
        '../dep/index.d.ts': 'export declare const foreign: "SECRET_SHAPE";\n',
      },
    });
    const declaration = records.get('Mixed')?.declaration ?? '';

    expect(declaration).toContain('// `foreign`: re-exported from a third-party package');
    expect(declaration).not.toContain('SECRET_SHAPE');
    expect(declaration).toContain('const own: 1;');
    expect(records.get('direct')?.external).toBe(true);
    expect(records.get('direct')?.declaration).toBeUndefined();
  });

  test('a sibling folder outside the package and outside node_modules is not third-party', () => {
    const records = recordsOf({
      directory: 'web',
      files: {
        'dist/index.d.ts':
          "export * as Mixed from './mixed.js';\nexport { near as direct } from '../../sibling/index.js';\n",
        'dist/mixed.d.ts': "export { near } from '../../sibling/index.js';\n",
        '../sibling/index.d.ts': 'export declare const near: 1;\n',
      },
    });

    expect(records.get('Mixed')?.declaration).toContain('const near: 1;');
    expect(records.get('direct')?.external).toBeUndefined();
    expect(records.get('direct')?.declaration).toContain('const near: 1;');
  });

  test('a sibling package linked into node_modules is not third-party: its real path counts', () => {
    const records = recordsOf({
      directory: 'web',
      files: {
        'dist/index.d.ts':
          "export * as Mixed from './mixed.js';\nexport { near as direct } from 'sibling';\n",
        'dist/mixed.d.ts': "export { near } from 'sibling';\n",
        '../sibling/package.json': JSON.stringify({ name: 'sibling', types: './index.d.ts' }),
        '../sibling/index.d.ts': 'export declare const near: 1;\n',
      },
      links: { '../node_modules/sibling': '../sibling' },
    });

    expect(records.get('Mixed')?.declaration).toContain('const near: 1;');
    expect(records.get('direct')?.external).toBeUndefined();
    expect(records.get('direct')?.declaration).toContain('const near: 1;');
  });

  test('an unexported type is shown at the highest level that uses it', () => {
    const records = recordsOf({
      files: {
        'dist/index.d.ts': "export * as Top from './top.js';\n",
        'dist/top.d.ts': [
          "export * as Inner from './inner.js';",
          "export { held } from './shared.js';",
          '',
        ].join('\n'),
        'dist/inner.d.ts': "export { held as again } from './shared.js';\n",
        'dist/shared.d.ts':
          'interface IHidden {\n    held: boolean;\n}\nexport declare const held: IHidden;\n',
      },
    });
    const declaration = records.get('Top')?.declaration ?? '';

    expect(declaration.split('held: boolean;').length).toBe(2);
    expect(declaration).toContain('\n    interface IHidden {\n        held: boolean;');
  });

  test('an unexported type of two sibling namespaces is shown in each', () => {
    const shared =
      'interface IHidden {\n    held: boolean;\n}\nexport declare const held: IHidden;\n';
    const records = recordsOf({
      files: {
        'dist/index.d.ts': "export * as Top from './top.js';\n",
        'dist/top.d.ts':
          "export * as Left from './left.js';\nexport * as Right from './right.js';\n",
        'dist/left.d.ts': "export { held } from './shared.js';\n",
        'dist/right.d.ts': "export { held } from './shared.js';\n",
        'dist/shared.d.ts': shared,
      },
    });
    const declaration = records.get('Top')?.declaration ?? '';

    expect(declaration.split('\n        interface IHidden {').length).toBe(3);
  });

  test('a declare namespace of a published .d.ts keeps its own text', () => {
    const records = recordsOf({
      files: {
        'dist/index.d.ts':
          'export declare namespace Config {\n    /** The port. */\n    const port: number;\n}\n',
      },
    });

    expect(records.get('Config')?.declaration).toBe(
      'export declare namespace Config {\n    /** The port. */\n    const port: number;\n}',
    );
  });

  test('a bundled declare namespace of export lists shows the members it names', () => {
    const records = recordsOf({
      files: {
        'dist/index.d.ts': [
          'declare const index_d_GET: "get";',
          'declare namespace index_d {',
          '  export { index_d_GET as GET };',
          '}',
          'export { index_d as HTTP };',
          '',
        ].join('\n'),
      },
    });

    expect(records.get('HTTP')?.declaration).toContain('declare const index_d_GET: "get";');
    expect(records.get('HTTP')?.declaration).toContain('index_d_GET as GET');
  });
});
