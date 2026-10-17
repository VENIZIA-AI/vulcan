import { afterAll, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSyncBounded } from '../spawn.helper.ts';

const CLI = join(import.meta.dir, '..', '..', 'cli.ts');
const OKF_INDEX = join(import.meta.dir, '..', '..', 'index.ts');

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** A renderer module that writes `content` at `path`, or throws when `content` is undefined. */
const moduleText = (opts: { id: string; path: string; content?: string }): string =>
  `import { defineRenderer } from '${OKF_INDEX}';

export default defineRenderer({
  id: '${opts.id}',
  collect: () => [],
  render: () => ${
    opts.content === undefined
      ? `{ throw new Error('the facts are not there'); }`
      : `({ path: ${JSON.stringify(opts.path)}, content: ${JSON.stringify(opts.content)} })`
  },
});
`;

const LONG_PAGE = `---\ntype: Reference\ntitle: Long\ndescription: A long page.\n---\n\n# Long\n\n## Part\n\n${Array.from({ length: 110 }, (_unused, index) => `Row ${index}.`).join('\n')}\n`;

const makeProject = (opts: { modules: { id: string; path: string; content?: string }[] }) => {
  const root = mkdtempSync(join(tmpdir(), 'okf-gen-safety-'));

  roots.push(root);
  mkdirSync(join(root, '.agents', 'knowledge'), { recursive: true });
  writeFileSync(join(root, '.agents', 'knowledge', 'index.md'), '# Knowledge\n');

  for (const module of opts.modules) {
    const file = join(root, '.agents', 'okf', `${module.id}.ts`);

    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, moduleText(module));
  }

  const config = {
    okf: {
      renderers: opts.modules.map(module => ({
        id: module.id,
        module: `.agents/okf/${module.id}.ts`,
      })),
    },
  };
  const run = (args: string[]) => {
    const child = spawnSyncBounded({
      cmd: [process.execPath, CLI, ...args],
      env: { ...process.env, VULCAN_CONFIG: JSON.stringify(config), VULCAN_PROJECT_ROOT: root },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    return { code: child.exitCode, output: child.stdout.toString() + child.stderr.toString() };
  };

  return { root, run };
};

test("gen is a fixed point: a renderer's long page passes check --strict after one gen", () => {
  const { root, run } = makeProject({
    modules: [{ id: 'long', path: 'reference/long.md', content: LONG_PAGE }],
  });

  expect(run(['gen']).code).toBe(0);

  const first = readFileSync(join(root, '.agents/knowledge/reference/long.md'), 'utf8');
  const checked = run(['check', '--strict']);

  expect(checked.output).not.toContain('reference/long.md');
  expect(run(['gen']).code).toBe(0);
  expect(readFileSync(join(root, '.agents/knowledge/reference/long.md'), 'utf8')).toBe(first);
});

test('a renderer path outside the bundle stops gen before anything is written', () => {
  const { root, run } = makeProject({
    modules: [
      { id: 'fine', path: 'reference/fine.md', content: '# Fine\n' },
      { id: 'escape', path: '../../escaped.md', content: '# Escaped\n' },
    ],
  });
  const result = run(['gen']);

  expect(result.code).not.toBe(0);
  expect(result.output).toContain(
    "okf: renderer 'escape' writes ../../escaped.md, outside the bundle",
  );
  expect(existsSync(join(root, 'escaped.md'))).toBe(false);
  expect(existsSync(join(root, '.agents/knowledge/reference/fine.md'))).toBe(false);
});

test('two renderers writing one path stop gen, naming both', () => {
  const { run } = makeProject({
    modules: [
      { id: 'first', path: 'reference/same.md', content: '# First\n' },
      { id: 'second', path: 'reference/same.md', content: '# Second\n' },
    ],
  });
  const result = run(['gen']);

  expect(result.code).not.toBe(0);
  expect(result.output).toContain(
    "okf: renderers 'first' and 'second' both write reference/same.md",
  );
});

test('a renderer that throws is named, and nothing is written', () => {
  const { root, run } = makeProject({
    modules: [
      { id: 'fine', path: 'reference/fine.md', content: '# Fine\n' },
      { id: 'broken', path: 'reference/broken.md' },
    ],
  });
  const result = run(['gen']);

  expect(result.code).not.toBe(0);
  expect(result.output).toContain("okf: renderer 'broken' failed: the facts are not there");
  expect(existsSync(join(root, '.agents/knowledge/reference/fine.md'))).toBe(false);
});
