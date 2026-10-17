import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSyncBounded } from '../spawn.helper.ts';

const CLI = join(import.meta.dir, '..', '..', 'cli.ts');

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const concept = (opts: { title: string; resource?: string }): string =>
  [
    '---',
    'type: Component',
    `title: ${opts.title}`,
    `description: ${opts.title}.`,
    ...(opts.resource === undefined ? [] : [`resource: ${opts.resource}`]),
    '---',
    '',
    `# ${opts.title}`,
    '',
  ].join('\n');

/** A project with `apps/{shop,blog,docs}` directories and the given concepts, by path under the bundle. */
const makeProject = (opts: { concepts: Record<string, string> }) => {
  const root = mkdtempSync(join(tmpdir(), 'okf-coverage-resource-'));

  roots.push(root);

  for (const app of ['shop', 'blog', 'docs']) {
    mkdirSync(join(root, 'apps', app), { recursive: true });
  }

  mkdirSync(join(root, '.agents', 'knowledge'), { recursive: true });
  writeFileSync(join(root, '.agents', 'knowledge', 'index.md'), '# Knowledge\n');

  for (const [path, text] of Object.entries(opts.concepts)) {
    const file = join(root, '.agents', 'knowledge', path);

    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }

  const config = { okf: { coverage: [{ name: 'apps', path: 'apps/*' }] } };

  return (args: string[]) => {
    const child = spawnSyncBounded({
      cmd: [process.execPath, CLI, 'coverage', ...args],
      env: { ...process.env, VULCAN_CONFIG: JSON.stringify(config), VULCAN_PROJECT_ROOT: root },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    return { code: child.exitCode, output: child.stdout.toString() + child.stderr.toString() };
  };
};

test('a concept at /<axis>/<dir>.md still covers its directory', () => {
  const run = makeProject({
    concepts: { 'apps/shop.md': concept({ title: 'Shop' }) },
  });

  expect(run([]).output).toMatch(/apps\s+1\/3/);
});

test("a concept elsewhere covers a directory when its frontmatter resource is the directory's path", () => {
  const run = makeProject({
    concepts: {
      'frontend/shop.md': concept({ title: 'Shop', resource: 'apps/shop' }),
      'frontend/blog.md': concept({ title: 'Blog', resource: 'apps/blog/' }),
      'apps/docs.md': concept({ title: 'Docs' }),
    },
  });
  const result = run(['--min', '100']);

  expect(result.output).toMatch(/apps\s+3\/3/);
  expect(result.code).toBe(0);
});

test('a resource that is not an axis directory covers nothing, and the gap is named', () => {
  const run = makeProject({
    concepts: {
      'frontend/shop.md': concept({ title: 'Shop', resource: 'apps/shop/src' }),
      'frontend/other.md': concept({ title: 'Other', resource: 'packages/shop' }),
    },
  });
  const result = run(['--min', '100']);

  expect(result.output).toMatch(/apps\s+0\/3\s+0%\s+missing: blog, docs, shop/);
  expect(result.code).toBe(1);
});
