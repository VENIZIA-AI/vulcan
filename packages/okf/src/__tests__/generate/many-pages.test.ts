import { afterAll, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';

const CLI = join(import.meta.dir, '..', '..', 'cli.ts');
const OKF_INDEX = join(import.meta.dir, '..', '..', 'index.ts');

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** A project whose renderers are the given module bodies; `render` is the source of the render function. */
const makeProject = (opts: { modules: { id: string; render: string }[] }) => {
  const root = mkdtempSync(join(tmpdir(), 'okf-many-pages-'));

  roots.push(root);
  mkdirSync(join(root, '.agents', 'knowledge'), { recursive: true });
  mkdirSync(join(root, '.agents', 'okf'), { recursive: true });
  writeFileSync(join(root, '.agents', 'knowledge', 'index.md'), '# Knowledge\n');

  for (const module of opts.modules) {
    writeFileSync(
      join(root, '.agents', 'okf', `${module.id}.ts`),
      `import { defineRenderer } from '${OKF_INDEX}';\n\nexport default defineRenderer({ id: '${module.id}', collect: () => [], render: ${module.render} });\n`,
    );
  }

  const config = {
    okf: {
      renderers: opts.modules.map((module) => ({
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
    const stdout = child.stdout.toString();
    const stderr = child.stderr.toString();

    return { code: child.exitCode, stdout, stderr, output: stdout + stderr };
  };

  return { root, run };
};

const PAGE = (title: string): string =>
  `---\ntype: Reference\ntitle: ${title}\ndescription: ${title}.\n---\n\n# ${title}\n`;

const TWO_PAGES = `() => [
  { path: 'reference/entities/orders.md', content: ${JSON.stringify(PAGE('Orders'))} },
  { path: 'reference/entities/users.md', content: ${JSON.stringify(PAGE('Users'))} },
]`;

test('a renderer returning an array writes every page, and a second gen is a no-op', () => {
  const { root, run } = makeProject({ modules: [{ id: 'entities', render: TWO_PAGES }] });
  const first = run(['gen']);

  expect(first.code).toBe(0);
  expect(readFileSync(join(root, '.agents/knowledge/reference/entities/orders.md'), 'utf8')).toBe(
    PAGE('Orders'),
  );
  expect(readFileSync(join(root, '.agents/knowledge/reference/entities/users.md'), 'utf8')).toBe(
    PAGE('Users'),
  );
  expect(run(['gen']).stdout).toBe('gen: up to date\n');
});

test('a renderer returning an empty array writes nothing and does not fail', () => {
  const { root, run } = makeProject({ modules: [{ id: 'none', render: '() => []' }] });

  expect(run(['gen']).code).toBe(0);
  expect(existsSync(join(root, '.agents/knowledge/reference'))).toBe(false);
});

test('one renderer naming a path twice stops gen, naming the renderer', () => {
  const { root, run } = makeProject({
    modules: [
      {
        id: 'twice',
        render: `() => [{ path: 'reference/a.md', content: '# A\\n' }, { path: 'reference/a.md', content: '# B\\n' }]`,
      },
    ],
  });
  const result = run(['gen']);

  expect(result.code).not.toBe(0);
  expect(result.output).toContain("okf: renderers 'twice' and 'twice' both write reference/a.md");
  expect(existsSync(join(root, '.agents/knowledge/reference/a.md'))).toBe(false);
});

test('one page of an array outside the bundle stops gen before any page is written', () => {
  const { root, run } = makeProject({
    modules: [
      {
        id: 'escape',
        render: `() => [{ path: 'reference/ok.md', content: '# Ok\\n' }, { path: '../../out.md', content: '# Out\\n' }]`,
      },
    ],
  });
  const result = run(['gen']);

  expect(result.code).not.toBe(0);
  expect(result.output).toContain("okf: renderer 'escape' writes ../../out.md, outside the bundle");
  expect(existsSync(join(root, '.agents/knowledge/reference/ok.md'))).toBe(false);
});

test('check --strict sees a stale page of an array renderer', () => {
  const { root, run } = makeProject({ modules: [{ id: 'entities', render: TWO_PAGES }] });

  run(['gen']);
  writeFileSync(join(root, '.agents/knowledge/reference/entities/users.md'), PAGE('Edited'));

  const checked = run(['check', '--strict']);

  expect(checked.code).not.toBe(0);
  expect(checked.output).toContain('reference/entities/users.md');
  expect(checked.output).not.toContain('reference/entities/orders.md');
});
