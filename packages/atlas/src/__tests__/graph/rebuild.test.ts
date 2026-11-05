import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ProjectConfig } from '@/common/project-config';
import type { ISymbolRecord } from '@/symbols/common/types';
import { GraphDecisions, GraphLevels } from '@/graph/common/constants';
import type { IFingerprints } from '@/graph/common/types';
import { Fingerprints } from '@/graph/fingerprints';
import { GitState } from '@/graph/git-state';
import { GraphBuild } from '@/graph/graph-build';
import type { ICodeGraph } from '@/graph/common/types';
import { RebuildPlan } from '@/graph/rebuild-plan';
import { SurfaceReader } from '@/graph/surface-reader';
import { MANIFEST, git, removeRepositories, repository } from './graph.helper';

afterAll(removeRepositories);

const skeleton = (text: string): string => SurfaceReader.of({ text, path: 'x.ts' });

describe('SurfaceReader: the skeleton of a file', () => {
  const base = [
    "import { z } from 'zod';",
    '/** Docs. */',
    'export function add(a: number, b: number): number {',
    '  return a + b;',
    '}',
    'export class Box {',
    '  value = 1;',
    '  get(): number {',
    '    return this.value;',
    '  }',
    '}',
    '',
  ].join('\n');

  test('an edit inside a body, a comment or the layout does not move it', () => {
    expect(skeleton(base.replace('return a + b;', 'const sum = a + b;\n  return sum * 1;'))).toBe(
      skeleton(base),
    );
    expect(
      skeleton(base.replace('/** Docs. */', '// a different comment\n/* and another */')),
    ).toBe(skeleton(base));
    expect(skeleton(base.replaceAll('  ', '    ').replace('{\n', '{\n\n'))).toBe(skeleton(base));
    expect(skeleton(base.replace('return this.value;', 'return 5;'))).toBe(skeleton(base));
  });

  test.each([
    ['a parameter type', 'a: number, b: number', 'a: number, b: string'],
    ['a return type', '): number {\n  return a + b;', '): string {\n  return a + b;'],
    ['a new export', 'export class Box', 'export const extra = 1;\nexport class Box'],
    ['an initializer', 'value = 1;', 'value = 2;'],
    ['an import', "from 'zod'", "from 'zod/v4'"],
    ['a member', '  get(): number {', '  peek(): number {'],
  ])('%s moves it', (_, from, to) => {
    expect(skeleton(base.replace(from, to))).not.toBe(skeleton(base));
  });
});

describe('RebuildPlan.levelOf', () => {
  const file = { package: '@fx/a', content: 'c1', surface: 's1', imports: 'i1' };

  test.each([
    [file, file, GraphLevels.NONE],
    [file, { ...file, content: 'c2' }, GraphLevels.COSMETIC],
    [file, { ...file, content: 'c2', surface: 's2' }, GraphLevels.STRUCTURAL],
    [file, { ...file, content: 'c2', imports: 'i2' }, GraphLevels.STRUCTURAL],
    [undefined, file, GraphLevels.STRUCTURAL],
    [file, undefined, GraphLevels.STRUCTURAL],
  ])('%j to %j is %s', (before, after, level) => {
    expect(RebuildPlan.levelOf({ before, after })).toBe(level);
  });
});

describe('RebuildPlan.decide', () => {
  const fingerprints = (
    files: IFingerprints['files'],
    extra: Partial<IFingerprints> = {},
  ): IFingerprints => ({
    schemaVersion: 1,
    files,
    declarations: { '@fx/a': 'd1', '@fx/b': 'd1' },
    inputs: 'in1',
    ...extra,
  });
  const entry = (
    owner: string,
    content: string,
    surface = 's',
  ): IFingerprints['files'][string] => ({
    package: owner,
    content,
    surface,
    imports: 'i',
  });
  const dependents = new Map([['@fx/a', ['@fx/b']]]);
  const decide = (opts: {
    before?: IFingerprints;
    after: IFingerprints;
    full?: boolean;
    hasGraph?: boolean;
  }) =>
    RebuildPlan.decide({
      before: opts.before,
      after: opts.after,
      full: opts.full === true,
      hasGraph: opts.hasGraph ?? true,
      dependents,
    });
  const same = fingerprints({ 'a/x.ts': entry('@fx/a', 'c'), 'b/y.ts': entry('@fx/b', 'c') });

  test('no earlier build, no graph file or --full: full', () => {
    expect(decide({ after: same }).decision).toBe(GraphDecisions.FULL);
    expect(decide({ before: same, after: same, hasGraph: false }).decision).toBe(
      GraphDecisions.FULL,
    );
    expect(decide({ before: same, after: same, full: true }).decision).toBe(GraphDecisions.FULL);
  });

  test('nothing changed, or bytes only: skip', () => {
    expect(decide({ before: same, after: same }).decision).toBe(GraphDecisions.SKIP);

    const cosmetic = fingerprints({
      'a/x.ts': entry('@fx/a', 'c2'),
      'b/y.ts': entry('@fx/b', 'c'),
    });
    const plan = decide({ before: same, after: cosmetic });

    expect(plan.decision).toBe(GraphDecisions.SKIP);
    expect(plan.cosmetic).toEqual(['a/x.ts']);
    expect(plan.packages).toEqual([]);
  });

  test('one structural file: partial, for its package and the packages that depend on it', () => {
    const after = fingerprints({
      'a/x.ts': entry('@fx/a', 'c2', 's2'),
      'b/y.ts': entry('@fx/b', 'c'),
    });
    const plan = decide({ before: same, after });

    expect(plan.decision).toBe(GraphDecisions.PARTIAL);
    expect(plan.packages).toEqual(['@fx/a', '@fx/b']);
    expect(plan.structural).toEqual(['a/x.ts']);
  });

  test('a structural file of a package nothing depends on: partial for that package alone', () => {
    const after = fingerprints({
      'a/x.ts': entry('@fx/a', 'c'),
      'b/y.ts': entry('@fx/b', 'c2', 's2'),
    });

    expect(decide({ before: same, after }).packages).toEqual(['@fx/b']);
  });

  test('new built declarations of a package: partial for it, with no file changed', () => {
    const after = fingerprints(same.files, { declarations: { '@fx/a': 'd1', '@fx/b': 'd2' } });
    const plan = decide({ before: same, after });

    expect(plan.decision).toBe(GraphDecisions.PARTIAL);
    expect(plan.packages).toEqual(['@fx/b']);
  });

  test('a new file or a gone file is structural', () => {
    const three = fingerprints({
      'a/x.ts': entry('@fx/a', 'c'),
      'a/z.ts': entry('@fx/a', 'c'),
      'b/y.ts': entry('@fx/b', 'c'),
    });
    const added = fingerprints({ ...three.files, 'a/new.ts': entry('@fx/a', 'n') });
    const { 'b/y.ts': _gone, ...rest } = three.files;

    expect(decide({ before: three, after: added })).toMatchObject({
      decision: GraphDecisions.PARTIAL,
      structural: ['a/new.ts'],
    });
    expect(decide({ before: three, after: fingerprints(rest) })).toMatchObject({
      decision: GraphDecisions.PARTIAL,
      structural: ['b/y.ts'],
    });
  });

  test('other settings, a changed package.json, or too many structural files: full', () => {
    expect(
      decide({ before: same, after: fingerprints(same.files, { inputs: 'in2' }) }).decision,
    ).toBe(GraphDecisions.FULL);

    const manifest = (content: string) =>
      fingerprints({
        ...same.files,
        'a/package.json': { package: '@fx/a', content, manifest: true },
      });

    expect(decide({ before: manifest('m1'), after: manifest('m2') }).decision).toBe(
      GraphDecisions.FULL,
    );

    const many = (suffix: string) =>
      fingerprints(
        Object.fromEntries(
          Array.from({ length: 100 }, (_, index) => [
            `a/f${index}.ts`,
            entry('@fx/a', `c${suffix}`, `s${suffix}`),
          ]),
        ),
      );
    const thirtyOne = fingerprints(
      Object.fromEntries(
        Array.from({ length: 100 }, (_, index) => [
          `a/f${index}.ts`,
          index < 31 ? entry('@fx/a', 'x', 'sx') : entry('@fx/a', 'c0', 's0'),
        ]),
      ),
    );
    const thirty = fingerprints(
      Object.fromEntries(
        Array.from({ length: 100 }, (_, index) => [
          `a/f${index}.ts`,
          index < 30 ? entry('@fx/a', 'x', 'sx') : entry('@fx/a', 'c0', 's0'),
        ]),
      ),
    );

    expect(decide({ before: many('0'), after: thirty }).decision).toBe(GraphDecisions.PARTIAL);
    expect(decide({ before: many('0'), after: thirtyOne }).decision).toBe(GraphDecisions.FULL);
  });

  test('more than half of the files structural: full, even under 30', () => {
    const before = fingerprints({
      'a/1.ts': entry('@fx/a', 'c'),
      'a/2.ts': entry('@fx/a', 'c'),
      'a/3.ts': entry('@fx/a', 'c'),
    });
    const after = fingerprints({
      'a/1.ts': entry('@fx/a', 'd', 'sd'),
      'a/2.ts': entry('@fx/a', 'd', 'sd'),
      'a/3.ts': entry('@fx/a', 'c'),
    });

    expect(decide({ before, after }).decision).toBe(GraphDecisions.FULL);
  });
});

describe('GraphBuild on a fixture repository', () => {
  const project = (root: string) => ProjectConfig.toAtlasProject({ root, manifest: MANIFEST });
  const run = (root: string, full = false) => {
    const built = GraphBuild.run({ root, project: project(root), full, read: () => [] });

    if (built === undefined) {
      throw new Error('the fixture is a repository');
    }

    return built;
  };
  const codeOf = (root: string): string =>
    readFileSync(join(root, '.agents/local/graph/code.json'), 'utf8');
  const metaOf = (root: string) =>
    JSON.parse(readFileSync(join(root, '.agents/local/graph/meta.json'), 'utf8'));

  test('the first build is full and writes the graph, the fingerprints and the meta', () => {
    const root = repository();
    const built = run(root);

    expect(built.plan.decision).toBe(GraphDecisions.FULL);
    expect(metaOf(root)).toMatchObject({ schemaVersion: 1, dirty: false, decision: 'full' });
    expect(metaOf(root).builtAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(metaOf(root).scope).toEqual(['packages/a', 'packages/b', 'packages/c', 'packages/d']);
  });

  test('nothing changed: skip, and the graph file is not rewritten', () => {
    const root = repository();

    run(root);

    const before = codeOf(root);
    const second = run(root);

    expect(second.plan.decision).toBe(GraphDecisions.SKIP);
    expect(codeOf(root)).toBe(before);
    expect(metaOf(root).decision).toBe('skip');
  });

  test('an edit inside a function body is bytes only: skip, and the next build sees the new bytes as the baseline', () => {
    const root = repository();

    run(root);
    writeFileSync(
      join(root, 'packages/a/src/util.ts'),
      'export const util = 1;\nexport function f(): number {\n  return 1;\n}\n',
    );
    git({ root, args: ['add', '-A'] });
    git({ root, args: ['commit', '-q', '-m', 'add f'] });

    const afterSignature = run(root);

    expect(afterSignature.plan.decision).toBe(GraphDecisions.PARTIAL);

    writeFileSync(
      join(root, 'packages/a/src/util.ts'),
      'export const util = 1;\nexport function f(): number {\n  return 2 + 3;\n}\n',
    );

    const afterBody = run(root);

    expect(afterBody.plan.decision).toBe(GraphDecisions.SKIP);
    expect(afterBody.plan.cosmetic).toEqual(['packages/a/src/util.ts']);
    expect(run(root).plan.cosmetic).toEqual([]);
  });

  test('a new exported signature: partial, for the package and the one that depends on it', () => {
    const root = repository();

    run(root);
    writeFileSync(
      join(root, 'packages/a/src/util.ts'),
      'export const util = 1;\nexport const added = 2;\n',
    );

    const built = run(root);

    expect(built.plan.decision).toBe(GraphDecisions.PARTIAL);
    expect(built.plan.packages).toEqual(['@fx/a', '@fx/b']);
    expect(built.graph.nodes.some((node) => node.id === 'file:packages/a/src/util.ts')).toBe(true);
  });

  test('a changed package.json, or --full: full', () => {
    const root = repository();

    run(root);
    writeFileSync(
      join(root, 'packages/d/package.json'),
      JSON.stringify({ name: '@fx/d', version: '1.0.1', exports: { '.': './src/index.ts' } }),
    );

    expect(run(root).plan.decision).toBe(GraphDecisions.FULL);
    expect(run(root).plan.decision).toBe(GraphDecisions.SKIP);
    expect(run(root, true).plan.decision).toBe(GraphDecisions.FULL);
  });

  test('a partial build gives the same graph as a full one', () => {
    const root = repository();

    run(root);
    writeFileSync(
      join(root, 'packages/c/src/lib/x.ts'),
      'export const x = 1;\nexport const y = 2;\n',
    );

    const partial = run(root);
    const full = run(root, true);

    expect(partial.plan.decision).toBe(GraphDecisions.PARTIAL);
    expect(JSON.stringify(partial.graph.nodes)).toBe(JSON.stringify(full.graph.nodes));
    expect(JSON.stringify(partial.graph.edges)).toBe(JSON.stringify(full.graph.edges));
  });

  test('a partial build keeps the symbols of the packages it does not read again, and equals a full build', () => {
    const root = repository();
    const record = (
      name: string,
      pkg: string,
      file: string,
      uses: string[] = [],
    ): ISymbolRecord => ({
      name,
      package: pkg,
      subpath: '.',
      specifier: pkg,
      kind: 'class',
      file,
      line: 1,
      signature: `class ${name}`,
      declaration: `declare class ${name} {}`,
      shape: `shape-${name}`,
      uses,
    });
    const all = [
      record('A1', '@fx/a', 'packages/a/src/index.ts', ['A2']),
      record('A2', '@fx/a', 'packages/a/src/util.ts'),
      record('C1', '@fx/c', 'packages/c/src/index.ts'),
    ];
    const read = (opts: { project: ReturnType<typeof project> }): ISymbolRecord[] => {
      const names = opts.project.packages.map((item) => item.name);

      return all.filter((item) => names.includes(item.package));
    };
    const build = (full = false) => {
      const built = GraphBuild.run({ root, project: project(root), full, read });

      if (built === undefined) {
        throw new Error('the fixture is a repository');
      }

      return built;
    };

    build();
    writeFileSync(
      join(root, 'packages/c/src/lib/x.ts'),
      'export const x = 1;\nexport const y = 2;\n',
    );

    const partial = build();
    const full = build(true);

    expect(partial.plan.decision).toBe(GraphDecisions.PARTIAL);
    expect(partial.plan.packages).toEqual(['@fx/c']);
    expect(
      partial.graph.nodes.filter((node) => node.kind === 'symbol').map((node) => node.id),
    ).toEqual(['sym:@fx/a#A1', 'sym:@fx/a#A2', 'sym:@fx/c#C1']);
    expect(partial.graph.edges.some((edge) => edge.kind === 'uses')).toBe(true);
    expect(JSON.stringify(partial.graph)).toBe(JSON.stringify(full.graph));
  });

  test('a package that publishes its source is read again after any edit: a comment moves the line of a symbol', () => {
    const root = repository();
    const real = (full = false) => {
      const built = GraphBuild.run({ root, project: project(root), full });

      if (built === undefined) {
        throw new Error('the fixture is a repository');
      }

      return built;
    };
    const symbolOf = (graph: ICodeGraph, id: string) =>
      graph.nodes.find((node) => node.id === id)?.symbol;

    const first = real();

    expect(symbolOf(first.graph, 'sym:@fx/d#d')).toMatchObject({ line: 1, documented: false });

    writeFileSync(
      join(root, 'packages/d/src/index.ts'),
      '// a note\n/** Now documented. */\nexport const d = 1;\n',
    );

    const second = real();

    expect(second.plan.decision).not.toBe(GraphDecisions.SKIP);
    expect(symbolOf(second.graph, 'sym:@fx/d#d')).toMatchObject({ line: 3, documented: true });
    expect(JSON.stringify(second.graph)).toBe(JSON.stringify(real(true).graph));
  });

  test('a build whose symbol reader failed is not a baseline: the next build reads everything again', () => {
    const root = repository();
    const failing = GraphBuild.run({
      root,
      project: project(root),
      read: () => {
        throw new Error('no typescript to read with');
      },
    });

    expect(failing?.error).toBe('no typescript to read with');

    const next = GraphBuild.run({ root, project: project(root), read: () => [] });

    expect(next?.plan.decision).toBe(GraphDecisions.FULL);
    expect(GraphBuild.run({ root, project: project(root), read: () => [] })?.plan.decision).toBe(
      GraphDecisions.SKIP,
    );
  });

  test('a skip prints the commit of now, and the graph of another format is not reused', () => {
    const root = repository();

    run(root);
    writeFileSync(
      join(root, '.agents/local/graph/code.json'),
      '{"schemaVersion":99,"kind":"code"}',
    );

    expect(run(root).plan.decision).toBe(GraphDecisions.FULL);
    expect(run(root).commit).toBe(GitState.commitOf({ root }));
  });
});

describe('Fingerprints: the built declarations of a package', () => {
  const built = (opts: { entry: string; files: Record<string, string> }): string => {
    const root = repository();

    writeFileSync(
      join(root, 'packages/b/package.json'),
      JSON.stringify({ name: '@fx/b', version: '1.0.0', exports: { '.': opts.entry } }),
    );

    for (const [path, text] of Object.entries(opts.files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }

    return root;
  };
  const digest = (root: string): string =>
    Fingerprints.declarationsOfPackages({
      root,
      project: ProjectConfig.toAtlasProject({ root, manifest: MANIFEST }),
    })['@fx/b'] ?? '';

  test('is empty for a package that has built nothing, and moves when a .d.ts below the entry changes', () => {
    const root = built({ entry: './dist/index.d.ts', files: {} });

    expect(digest(root)).toBe('');

    writeFileSync(join(root, 'packages/b/dist-placeholder'), '');
    mkdirSync(join(root, 'packages/b/dist/sub'), { recursive: true });
    writeFileSync(join(root, 'packages/b/dist/index.d.ts'), 'export declare const b: 1;\n');
    writeFileSync(join(root, 'packages/b/dist/sub/inner.d.ts'), 'export declare const i: 1;\n');

    const first = digest(root);

    expect(first).not.toBe('');
    expect(digest(root)).toBe(first);

    writeFileSync(join(root, 'packages/b/dist/sub/inner.d.ts'), 'export declare const i: 1 | 2;\n');

    expect(digest(root)).not.toBe(first);
  });

  test('an entry at the root of the package is digested too', () => {
    const root = built({
      entry: './index.d.ts',
      files: { 'packages/b/index.d.ts': 'export declare const b: 1;\n' },
    });
    const first = digest(root);

    expect(first).not.toBe('');

    writeFileSync(join(root, 'packages/b/index.d.ts'), 'export declare const b: 1 | 2;\n');

    expect(digest(root)).not.toBe(first);
  });
});
