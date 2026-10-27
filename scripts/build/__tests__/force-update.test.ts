import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';

const SCRIPT = join(import.meta.dir, '..', 'force-update.sh');
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const runForceUpdate = (opts: { manifest: object }): { stdout: string; manifest: string } => {
  const root = mkdtempSync(join(tmpdir(), 'force-update-'));
  roots.push(root);
  writeFileSync(join(root, 'package.json'), `${JSON.stringify(opts.manifest, null, 2)}\n`);

  const result = spawnSyncBounded({
    cmd: ['sh', SCRIPT, 'latest'],
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  return {
    stdout: result.stdout.toString(),
    manifest: readFileSync(join(root, 'package.json'), 'utf8'),
  };
};

test('a workspace sibling and a catalog pin are both left alone, without asking the registry', () => {
  const manifest = {
    name: '@venizia/vulcan',
    dependencies: { '@venizia/vulcan-okf': 'workspace:*', '@venizia/ignis-helpers': 'catalog:' },
  };
  const result = runForceUpdate({ manifest });

  expect(result.manifest).toBe(`${JSON.stringify(manifest, null, 2)}\n`);
  expect(result.stdout).toContain('[@venizia/vulcan-okf] a workspace sibling, SKIP');
  expect(result.stdout).toContain(
    '[@venizia/ignis-helpers] pinned by the root workspaces.catalog, SKIP',
  );
  expect(result.stdout).not.toContain('Fetching');
});
