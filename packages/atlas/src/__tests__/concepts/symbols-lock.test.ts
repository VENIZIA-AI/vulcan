import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkConcepts, ConceptProblems, stampConcepts, SYMBOLS_LOCK_NAME } from '@/concepts';
import { readAtlasProject } from '@/common/project-config';
import { isFormatted } from '../format.helper';
import { spawnSyncBounded } from '../spawn.helper';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const PACKAGE_ROOT = join(__dirname, '..', '..', '..');
const LOCK = `.agents/knowledge/${SYMBOLS_LOCK_NAME}`;
const DECLARATIONS =
  'export declare function greet(name: string): string;\nexport declare class Basket {\n}\n';

const GREETING = "---\ntitle: Greeting\nsymbols: ['@shop/kit#greet']\n---\n\n# Greeting\n";
const BASKET = "---\ntitle: Basket\nsymbols: ['@shop/kit#Basket']\n---\n\n# Basket\n";
const PLAIN = '---\ntitle: Plain\n---\n\n# Plain\n';

/** A project with one package, built when `declarations` is given, and the concepts given. */
const makeProject = (opts: {
  concepts: Record<string, string>;
  declarations?: string;
}): { root: string; write: (path: string, text: string) => void } => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-concepts-'));
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };

  roots.push(root);
  write(
    '.agents/vulcan.manifest.json',
    JSON.stringify({
      schemaVersion: 1,
      name: 'shop',
      packages: [{ name: '@shop/kit', dir: 'kit', aliases: [], retired: false }],
      knowledge: { bundle: '.agents/knowledge' },
    }),
  );
  write(
    'packages/kit/package.json',
    JSON.stringify({
      name: '@shop/kit',
      version: '0.0.1-0',
      private: true,
      exports: { '.': { types: './dist/index.d.ts' } },
    }),
  );

  if (opts.declarations !== undefined) {
    write('packages/kit/dist/index.d.ts', opts.declarations);
  }

  for (const [path, text] of Object.entries(opts.concepts)) {
    write(join('.agents/knowledge', path), text);
  }

  return { root, write };
};

const CONCEPTS = { 'index.md': PLAIN, 'kit/greeting.md': GREETING, 'kit/basket.md': BASKET };

describe('concepts stamp and check (V4)', () => {
  test('stamp writes the lock: each declared symbol with its signature hash', () => {
    const { root } = makeProject({ concepts: CONCEPTS, declarations: DECLARATIONS });
    const report = stampConcepts({ project: readAtlasProject({ root }) });
    const lock = JSON.parse(readFileSync(join(root, LOCK), 'utf8'));

    expect(report.missing).toEqual([]);
    expect(lock.schemaVersion).toBe(2);
    expect(Object.keys(lock.symbols)).toEqual(['@shop/kit#Basket', '@shop/kit#greet']);
    expect(lock.symbols['@shop/kit#greet']).toMatch(/^[0-9a-f]{8}$/);
  });

  test('the lock is already formatted for bun fmt, so a committed copy stays lint-green', () => {
    const { root } = makeProject({ concepts: CONCEPTS, declarations: DECLARATIONS });

    stampConcepts({ project: readAtlasProject({ root }) });

    const result = isFormatted({
      file: SYMBOLS_LOCK_NAME,
      text: readFileSync(join(root, LOCK), 'utf8'),
    });

    expect(result.ok, result.output).toBe(true);
  });

  test('check passes against a fresh stamp', () => {
    const { root } = makeProject({ concepts: CONCEPTS, declarations: DECLARATIONS });

    stampConcepts({ project: readAtlasProject({ root }) });

    const report = checkConcepts({ project: readAtlasProject({ root }) });

    expect(report.problems).toEqual([]);
    expect(report.checked).toBe(2);
  });

  test('a removed symbol fails, naming the concept to review', () => {
    const { root, write } = makeProject({ concepts: CONCEPTS, declarations: DECLARATIONS });

    stampConcepts({ project: readAtlasProject({ root }) });
    write('packages/kit/dist/index.d.ts', 'export declare class Basket {\n}\n');

    expect(checkConcepts({ project: readAtlasProject({ root }) }).problems).toEqual([
      {
        concept: '.agents/knowledge/kit/greeting.md',
        symbol: '@shop/kit#greet',
        problem: ConceptProblems.MISSING,
      },
    ]);
  });

  test('a changed signature fails', () => {
    const { root, write } = makeProject({ concepts: CONCEPTS, declarations: DECLARATIONS });

    stampConcepts({ project: readAtlasProject({ root }) });
    write(
      'packages/kit/dist/index.d.ts',
      DECLARATIONS.replace('(name: string)', '(name: string, loud: boolean)'),
    );

    expect(checkConcepts({ project: readAtlasProject({ root }) }).problems).toEqual([
      {
        concept: '.agents/knowledge/kit/greeting.md',
        symbol: '@shop/kit#greet',
        problem: ConceptProblems.CHANGED,
      },
    ]);
  });

  describe('the whole declaration is locked, not its one-line signature', () => {
    const MEMBERS = [
      'export interface Cart {',
      '  items: string[];',
      '  total(): number;',
      '}',
      'export declare class Basket {',
      '  add(item: string): void;',
      '}',
      'export declare function greet(name: string): string;',
      '',
    ].join('\n');
    const CART = "---\ntitle: Cart\nsymbols: ['@shop/kit#Cart']\n---\n\n# Cart\n";
    const concepts = { 'kit/cart.md': CART, 'kit/basket.md': BASKET };

    const problemsAfter = (change: (declarations: string) => string) => {
      const { root, write } = makeProject({ concepts, declarations: MEMBERS });

      stampConcepts({ project: readAtlasProject({ root }) });
      write('packages/kit/dist/index.d.ts', change(MEMBERS));

      return checkConcepts({ project: readAtlasProject({ root }) }).problems.map(
        (problem) => `${problem.symbol} ${problem.problem}`,
      );
    };

    test('a member added to an interface fails', () => {
      expect(
        problemsAfter((source) =>
          source.replace('  total(): number;', '  total(): number;\n  empty(): boolean;'),
        ),
      ).toEqual([`@shop/kit#Cart ${ConceptProblems.CHANGED}`]);
    });

    test('a member signature changed in a class fails', () => {
      expect(
        problemsAfter((source) =>
          source.replace('add(item: string): void', 'add(item: string, count: number): void'),
        ),
      ).toEqual([`@shop/kit#Basket ${ConceptProblems.CHANGED}`]);
    });

    test('whitespace, line breaks and comments do not move the lock', () => {
      expect(
        problemsAfter((source) =>
          source
            .replace('  items: string[];', '/** The items. */\n    items:   string[];   // inline')
            .replace(
              'add(item: string): void;',
              '\n  /** Adds. */\n  add(\n    item: string,\n  ): void;',
            ),
        ),
      ).toEqual([]);
    });

    test('a parameter changed in a long function signature fails even past the 300-character cap', () => {
      const long = (tail: string): string =>
        `export declare function build(${Array.from({ length: 30 }, (_unused, index) => `argument${index}: string`).join(', ')}, last: ${tail}): void;\n`;
      const { root, write } = makeProject({
        concepts: {
          'kit/build.md': "---\ntitle: Build\nsymbols: ['@shop/kit#build']\n---\n\n# Build\n",
        },
        declarations: long('string'),
      });

      stampConcepts({ project: readAtlasProject({ root }) });
      write('packages/kit/dist/index.d.ts', long('number'));

      expect(checkConcepts({ project: readAtlasProject({ root }) }).problems).toHaveLength(1);
    });
  });

  test('a lock written by an older atlas asks for a new stamp, not a wall of changed symbols', () => {
    const { root, write } = makeProject({ concepts: CONCEPTS, declarations: DECLARATIONS });

    write(LOCK, JSON.stringify({ schemaVersion: 1, symbols: { '@shop/kit#greet': 'deadbeef' } }));

    expect(() => checkConcepts({ project: readAtlasProject({ root }) })).toThrow('concepts stamp');
  });

  test('a declared symbol the lock lacks fails until stamped', () => {
    const { root, write } = makeProject({
      concepts: { 'kit/greeting.md': GREETING },
      declarations: DECLARATIONS,
    });

    stampConcepts({ project: readAtlasProject({ root }) });
    write('.agents/knowledge/kit/basket.md', BASKET);

    expect(checkConcepts({ project: readAtlasProject({ root }) }).problems).toEqual([
      {
        concept: '.agents/knowledge/kit/basket.md',
        symbol: '@shop/kit#Basket',
        problem: ConceptProblems.UNSTAMPED,
      },
    ]);
  });

  test('a concept without symbols: is ignored - no build, no lock needed', () => {
    const { root } = makeProject({ concepts: { 'index.md': PLAIN } });
    const report = checkConcepts({ project: readAtlasProject({ root }) });

    expect(report).toEqual({ checked: 0, problems: [] });
    expect(existsSync(join(root, LOCK))).toBe(false);
  });

  test('stamp refuses a symbol the build does not export, and writes nothing', () => {
    const { root } = makeProject({
      concepts: { 'kit/greeting.md': GREETING.replace('#greet', '#farewell') },
      declarations: DECLARATIONS,
    });
    const report = stampConcepts({ project: readAtlasProject({ root }) });

    expect(report.missing).toEqual([
      {
        concept: '.agents/knowledge/kit/greeting.md',
        symbol: '@shop/kit#farewell',
        problem: ConceptProblems.MISSING,
      },
    ]);
    expect(existsSync(join(root, LOCK))).toBe(false);
  });
});

describe('vulcan-atlas concepts', () => {
  const run = (opts: { args: string[]; cwd: string }) => {
    // The project is the working directory, never a manifest a parent `vulcan x` handed over.
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => name !== 'VULCAN_MANIFEST' && name !== 'VULCAN_PROJECT_ROOT',
      ),
    );
    // The fixture has no node_modules: without --no-install, bun would fetch the newest typescript.
    const result = spawnSyncBounded({
      cmd: [
        process.execPath,
        '--no-install',
        join(PACKAGE_ROOT, 'src/cli.ts'),
        'concepts',
        ...opts.args,
      ],
      cwd: opts.cwd,
      env,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    return {
      code: result.exitCode,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    };
  };

  test('stamp, then check passes; a changed signature exits 1 naming the concept', () => {
    const { root, write } = makeProject({ concepts: CONCEPTS, declarations: DECLARATIONS });

    expect(run({ args: ['stamp'], cwd: root })).toMatchObject({
      code: 0,
      stdout: `concepts: stamped 2 symbols into ${LOCK}\n`,
    });
    expect(run({ args: ['check'], cwd: root })).toMatchObject({
      code: 0,
      stdout: 'concepts: 2 symbols checked, 0 to review\n',
    });

    write(
      'packages/kit/dist/index.d.ts',
      DECLARATIONS.replace('(name: string)', '(name: string, loud: boolean)'),
    );

    const failed = run({ args: ['check'], cwd: root });

    expect(failed.code).toBe(1);
    expect(failed.stdout).toContain(
      'concepts: .agents/knowledge/kit/greeting.md names @shop/kit#greet - its signature changed',
    );
  });

  test('an unknown concepts command prints the usage and exits 2', () => {
    const { root } = makeProject({ concepts: CONCEPTS });
    const result = run({ args: ['verify'], cwd: root });

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('usage: vulcan x atlas concepts stamp|check');
  });
});
