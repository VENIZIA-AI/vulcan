import { describe, expect, test } from 'bun:test';
import type { IAtlasPackage } from '@/common/project-config';
import type { ISymbolRecord } from '@/symbols/common/types';
import { SymbolProducer } from '@/graph/symbol-producer';

const PACKAGES: IAtlasPackage[] = [
  { dir: 'core', name: '@fx/core', path: 'packages/core', aliases: [], retired: false },
  { dir: 'web', name: '@fx/web', path: 'packages/web', aliases: [], retired: false },
];

const record = (opts: {
  name: string;
  package?: string;
  specifier?: string;
  file?: string;
  uses?: string[];
  shape?: string;
  doc?: string;
  external?: boolean;
}): ISymbolRecord => ({
  name: opts.name,
  package: opts.package ?? 'core',
  subpath: '.',
  specifier: opts.specifier ?? '@fx/core',
  kind: 'class',
  file: opts.file ?? 'packages/core/src/index.ts',
  line: 3,
  signature: `class ${opts.name}`,
  ...(opts.shape === undefined ? {} : { shape: opts.shape }),
  ...(opts.doc === undefined ? {} : { doc: opts.doc }),
  ...(opts.uses === undefined ? {} : { uses: opts.uses }),
  ...(opts.external === true ? { external: true } : {}),
});

const FILES = new Set(['file:packages/core/src/index.ts', 'file:packages/core/src/other.ts']);

const produce = (records: ISymbolRecord[]) =>
  new SymbolProducer().produce({ records, packages: PACKAGES, fileIds: FILES });

const edgesOf = (records: ISymbolRecord[]): string[] =>
  produce(records)
    .edges.map((edge) => `${edge.kind} ${edge.from} -> ${edge.to}`)
    .sort();

describe('SymbolProducer', () => {
  test('a symbol is a node of its entry and its file; the node holds kind, line, shape and whether it is documented', () => {
    const part = produce([record({ name: 'Repo', shape: 'abc', doc: 'Stores things.' })]);

    expect(part.nodes).toEqual([
      {
        id: 'sym:@fx/core#Repo',
        kind: 'symbol',
        name: 'Repo',
        package: '@fx/core',
        symbol: { kind: 'class', line: 3, documented: true, shape: 'abc' },
      },
    ]);
    expect(edgesOf([record({ name: 'Repo' })])).toEqual([
      'contains file:packages/core/src/index.ts -> sym:@fx/core#Repo',
      'exports entry:@fx/core -> sym:@fx/core#Repo',
    ]);
  });

  test('no signature is stored, and a missing shape or doc is left out', () => {
    const [node] = produce([record({ name: 'Repo' })]).nodes;

    expect(node?.symbol).toEqual({ kind: 'class', line: 3, documented: false });
    expect(JSON.stringify(node)).not.toContain('signature');
  });

  test('a third-party re-export is a node of the entry, with no file edge', () => {
    const edges = edgesOf([
      record({ name: 'Z', external: true, file: 'node_modules/zod/index.d.ts' }),
    ]);

    expect(edges).toEqual(['exports entry:@fx/core -> sym:@fx/core#Z']);
    expect(produce([record({ name: 'Z', external: true })]).nodes[0]?.symbol?.thirdParty).toBe(
      true,
    );
  });

  test('a symbol declared in a file the graph does not hold has no contains edge', () => {
    expect(edgesOf([record({ name: 'Gone', file: 'packages/core/src/gone.ts' })])).toEqual([
      'exports entry:@fx/core -> sym:@fx/core#Gone',
    ]);
  });

  describe('a uses name', () => {
    test('resolves to the symbol of that name in the same entry first', () => {
      const edges = edgesOf([
        record({ name: 'A', uses: ['B'] }),
        record({ name: 'B' }),
        record({ name: 'B', specifier: '@fx/core/sub', file: 'packages/core/src/other.ts' }),
      ]);

      expect(edges).toContain('uses sym:@fx/core#A -> sym:@fx/core#B');
      expect(edges).not.toContain('uses sym:@fx/core#A -> sym:@fx/core/sub#B');
    });

    test('else to the only one of the package', () => {
      const edges = edgesOf([
        record({ name: 'A', uses: ['B'] }),
        record({ name: 'B', specifier: '@fx/core/sub', file: 'packages/core/src/other.ts' }),
      ]);

      expect(edges).toContain('uses sym:@fx/core#A -> sym:@fx/core/sub#B');
    });

    test('else to the only one of the project', () => {
      const edges = edgesOf([
        record({ name: 'A', uses: ['W'] }),
        record({ name: 'W', package: 'web', specifier: '@fx/web', file: 'packages/web/src/i.ts' }),
      ]);

      expect(edges).toContain('uses sym:@fx/core#A -> sym:@fx/web#W');
    });

    test('is not guessed when several candidates remain', () => {
      const edges = edgesOf([
        record({ name: 'A', uses: ['B'] }),
        record({ name: 'B', specifier: '@fx/core/x', file: 'packages/core/src/other.ts' }),
        record({ name: 'B', specifier: '@fx/core/y', file: 'packages/core/src/other.ts' }),
      ]);

      expect(edges.filter((edge) => edge.startsWith('uses'))).toEqual([]);
    });

    test('a name that is not exported, and a reference to itself, give no edge', () => {
      expect(
        edgesOf([record({ name: 'A', uses: ['Unknown', 'A'] })]).filter((edge) =>
          edge.startsWith('uses'),
        ),
      ).toEqual([]);
    });
  });

  test('the nodes come in id order whatever the order of the records', () => {
    const records = [record({ name: 'B' }), record({ name: 'A', uses: ['B'] })];
    const ids = (list: ISymbolRecord[]): string[] => produce(list).nodes.map((node) => node.id);

    expect(ids(records)).toEqual(['sym:@fx/core#A', 'sym:@fx/core#B']);
    expect(ids([...records].reverse())).toEqual(ids(records));
  });
});
