import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';
import { ChangelogPlaceholder } from '../check-changelog-placeholder.ts';

const ROOT = join(import.meta.dir, '..', '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'checks', 'check-changelog-placeholder.ts');
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const plant = (opts: { files: Record<string, string> }): string => {
  const root = mkdtempSync(join(tmpdir(), 'vulcan-changelog-'));

  roots.push(root);
  mkdirSync(join(root, 'docs', 'wiki', 'content', 'changelogs'), { recursive: true });

  for (const [name, text] of Object.entries(opts.files)) {
    writeFileSync(join(root, 'docs', 'wiki', 'content', 'changelogs', name), text);
  }

  return root;
};

const run = (opts: { root: string }) => {
  const result = spawnSyncBounded({
    cmd: [process.execPath, SCRIPT, '--root', opts.root],
    stdout: 'pipe',
    stderr: 'pipe',
  });

  return { code: result.exitCode, stderr: result.stderr.toString() };
};

test('the changelogs of this repository hold no placeholder', () => {
  const result = run({ root: ROOT });

  expect(result.stderr).toBe('');
  expect(result.code).toBe(0);
});

test('red control: a title, a heading or a body line with X.Y.Z fails, naming the file and line', () => {
  const root = plant({
    files: {
      '2026-10-27-a.md':
        '---\ntitle: "VULCAN X.Y.Z: List your own targets"\n---\n\n# Changelog - 2026-10-27\n\n## VULCAN X.Y.Z: list\n',
      '2026-10-28-b.md': '---\ntitle: Plain\n---\n\nUpgrade to X.Y.Z.\n',
    },
  });
  const result = run({ root });

  expect(result.code).toBe(1);
  expect(result.stderr).toContain('docs/wiki/content/changelogs/2026-10-27-a.md:2');
  expect(result.stderr).toContain('docs/wiki/content/changelogs/2026-10-27-a.md:7');
  expect(result.stderr).toContain('docs/wiki/content/changelogs/2026-10-28-b.md:5');
});

test('a root with no changelog folder fails with a message, not a pass', () => {
  const root = mkdtempSync(join(tmpdir(), 'vulcan-changelog-'));

  roots.push(root);

  const result = run({ root });

  expect(result.code).not.toBe(0);
  expect(result.stderr).toContain('docs/wiki/content/changelogs not found');
});

test('a real version, a plain title and the index page pass', () => {
  const root = plant({
    files: {
      '2026-10-27-a.md':
        '---\ntitle: "VULCAN 0.2.0-0: Real version"\n---\n\n## VULCAN 0.2.0-0: real\n',
      '2026-10-28-b.md': '---\ntitle: Plain sentence\n---\n\n## Plain sentence\n',
      'index.md': 'X.Y.Z is not a dated entry\n',
    },
  });

  expect(ChangelogPlaceholder.scan({ root })).toEqual([]);
  expect(run({ root }).code).toBe(0);
});
