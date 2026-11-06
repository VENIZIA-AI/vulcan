import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAnchorsCommand, runSourceLinksCommand } from '../../wiki/index.ts';
import { git } from '../git-repo.helper.ts';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';

const roots: string[] = [];

const repository = (opts: { link: string }): string => {
  const root = mkdtempSync(join(tmpdir(), 'vulcan-wiki-command-'));

  roots.push(root);
  git({ cwd: root, args: ['init', '--quiet'] });
  mkdirSync(join(root, 'docs/wiki/content'), { recursive: true });
  mkdirSync(join(root, 'packages/x'), { recursive: true });
  writeFileSync(join(root, 'packages/x/y.ts'), 'export {};\n');
  writeFileSync(
    join(root, 'docs/wiki/content/index.md'),
    `Source: https://github.com/VENIZIA-AI/acme/blob/main/${opts.link}\n`,
  );
  git({ cwd: root, args: ['add', '-A'] });

  return root;
};

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const quietly = <T>(run: () => T): T => {
  const log = console.log;
  const error = console.error;

  console.log = () => undefined;
  console.error = () => undefined;

  try {
    return run();
  } finally {
    console.log = log;
    console.error = error;
  }
};

describe('runSourceLinksCommand', () => {
  test('passes on a tracked path and fails on a missing one', () => {
    const args = ['--repo', 'VENIZIA-AI/acme'];

    expect(
      quietly(() => runSourceLinksCommand({ args, root: repository({ link: 'packages/x/y.ts' }) })),
    ).toBe(0);
    expect(
      quietly(() =>
        runSourceLinksCommand({ args, root: repository({ link: 'packages/x/gone.ts' }) }),
      ),
    ).toBe(1);
  });

  test('refuses to run without a repository slug, or with a malformed one', () => {
    const root = repository({ link: 'packages/x/y.ts' });

    expect(quietly(() => runSourceLinksCommand({ args: [], root }))).toBe(1);
    expect(quietly(() => runSourceLinksCommand({ args: ['--repo', 'acme'], root }))).toBe(1);
    expect(quietly(() => runSourceLinksCommand({ args: ['--repo'], root }))).toBe(1);
  });

  test('a broken link under a folder of the layout fails, and passes when the project has no layout', () => {
    const root = repository({ link: 'packages/x/y.ts' });
    const args = ['--repo', 'VENIZIA-AI/acme'];

    mkdirSync(join(root, 'apps/api'), { recursive: true });
    writeFileSync(join(root, 'apps/api/server.ts'), 'export {};\n');
    writeFileSync(
      join(root, 'docs/wiki/content/api.md'),
      'Server: `apps/api/server.ts` and `apps/api/gone.ts`\n',
    );
    git({ cwd: root, args: ['add', '-A'] });

    expect(quietly(() => runSourceLinksCommand({ args, root }))).toBe(0);
    expect(
      quietly(() => runSourceLinksCommand({ args, root, layout: { backend: 'apps/api' } })),
    ).toBe(1);
  });

  test('--dirs replaces the folders it walks', () => {
    const root = repository({ link: 'packages/x/gone.ts' });
    const args = ['--repo', 'VENIZIA-AI/acme', '--dirs', 'packages'];

    expect(quietly(() => runSourceLinksCommand({ args, root }))).toBe(0);
  });
});

describe('runAnchorsCommand', () => {
  test('fails with a message when there is no build', () => {
    const root = repository({ link: 'packages/x/y.ts' });

    expect(
      quietly(() => runAnchorsCommand({ args: ['--dist', join(root, 'no-dist')], root })),
    ).toBe(1);
  });
});

describe('the shipped entry scripts', () => {
  const entry = (name: string) =>
    join(import.meta.dir, '..', '..', '..', 'base', 'checks', `${name}.ts`);

  test('wiki-source-links exits 1 and names the missing flag when --repo is absent', () => {
    const root = repository({ link: 'packages/x/y.ts' });
    const result = spawnSyncBounded({ cmd: ['bun', entry('wiki-source-links')], cwd: root });

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain('--repo <owner/name> is required');
  });

  test('wiki-source-links exits 0 on a tracked path and 1 on a missing one', () => {
    const ok = spawnSyncBounded({
      cmd: ['bun', entry('wiki-source-links'), '--repo', 'VENIZIA-AI/acme'],
      cwd: repository({ link: 'packages/x/y.ts' }),
    });
    const bad = spawnSyncBounded({
      cmd: ['bun', entry('wiki-source-links'), '--repo', 'VENIZIA-AI/acme'],
      cwd: repository({ link: 'packages/x/gone.ts' }),
    });

    expect(ok.exitCode).toBe(0);
    expect(ok.stdout.toString()).toContain('1 paths checked, 0 missing');
    expect(bad.exitCode).toBe(1);
    expect(bad.stdout.toString()).toContain('docs/wiki/content/index.md:1 packages/x/gone.ts');
  });

  test('wiki-source-links reads the layout of the config: a broken link under its folder fails', () => {
    const root = repository({ link: 'packages/x/y.ts' });
    const run = () =>
      spawnSyncBounded({
        cmd: ['bun', entry('wiki-source-links'), '--repo', 'VENIZIA-AI/acme'],
        cwd: root,
      });

    mkdirSync(join(root, 'apps/api'), { recursive: true });
    mkdirSync(join(root, '.configs'), { recursive: true });
    writeFileSync(join(root, 'apps/api/server.ts'), 'export {};\n');
    writeFileSync(join(root, 'docs/wiki/content/api.md'), 'Gone: `apps/api/gone.ts`\n');
    writeFileSync(
      join(root, '.configs/vulcan.config.mts'),
      "export default { layout: { backend: 'apps/api' } };\n",
    );
    git({ cwd: root, args: ['add', '-A'] });

    const withLayout = run();

    expect(withLayout.exitCode).toBe(1);
    expect(withLayout.stdout.toString()).toContain('docs/wiki/content/api.md:1 apps/api/gone.ts');

    writeFileSync(join(root, '.configs/vulcan.config.mts'), 'export default {};\n');

    const withoutLayout = run();

    expect(withoutLayout.exitCode).toBe(0);
  });

  test('wiki-source-links says so when the config cannot be read, and checks the default folders', () => {
    const root = repository({ link: 'packages/x/gone.ts' });

    mkdirSync(join(root, '.configs'), { recursive: true });
    writeFileSync(join(root, '.configs/vulcan.config.mts'), 'export default { layout: 3 };\n');

    const result = spawnSyncBounded({
      cmd: ['bun', entry('wiki-source-links'), '--repo', 'VENIZIA-AI/acme'],
      cwd: root,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain('the project config could not be read');
    expect(result.stdout.toString()).toContain('packages/x/gone.ts');
  });

  test('wiki-anchors exits 1 and says to build first when there is no dist', () => {
    const result = spawnSyncBounded({
      cmd: ['bun', entry('wiki-anchors')],
      cwd: repository({ link: 'packages/x/y.ts' }),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toContain('run `make docs` first');
  });
});
