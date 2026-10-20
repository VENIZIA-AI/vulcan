import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateChangelogs } from '@/changelogs';
import { toAtlasProject } from '@/common/project-config';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const ENTRIES: Record<string, string> = {
  '2026-01-01-mention.md': '---\ntitle: Faster\n---\n\nThe `@acme/kernel` boots faster.\n',
  '2026-01-02-declared.md':
    "---\ntitle: Kept\npackages: ['@acme/web']\n---\n\nThe `@acme/kernel` too.\n",
  '2026-01-03-nothing.md': '---\ntitle: Vague\n---\n\nSomething changed.\n',
  '2026-01-04-bare.md': 'A file with no frontmatter about packages/kernel.\n',
  'index.md': '# Changes\n',
};

const projectWith = (): { root: string; read: (file: string) => string } => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-migrate-'));

  roots.push(root);
  mkdirSync(join(root, 'changes'));

  for (const [file, text] of Object.entries(ENTRIES)) {
    writeFileSync(join(root, 'changes', file), text);
  }

  return { root, read: (file: string) => readFileSync(join(root, 'changes', file), 'utf8') };
};

const PACKAGES = [
  { name: '@acme/kernel', dir: 'kernel', aliases: [], retired: false },
  { name: '@acme/web', dir: 'web', aliases: [], retired: false },
];

const projectAt = (opts: { root: string }) =>
  toAtlasProject({
    root: opts.root,
    manifest: { schemaVersion: 1, packages: PACKAGES, knowledge: { changelogs: 'changes' } },
  });

describe('migrateChangelogs (C3)', () => {
  test('writes the resolved npm names into each entry that declares none', () => {
    const { root, read } = projectWith();
    const report = migrateChangelogs({ project: projectAt({ root }), write: true });

    expect(report.written).toEqual(['changes/2026-01-01-mention.md', 'changes/2026-01-04-bare.md']);
    expect(read('2026-01-01-mention.md')).toBe(
      "---\ntitle: Faster\npackages: ['@acme/kernel']\n---\n\nThe `@acme/kernel` boots faster.\n",
    );
    expect(read('2026-01-04-bare.md')).toBe(
      "---\npackages: ['@acme/kernel']\n---\n\nA file with no frontmatter about packages/kernel.\n",
    );
  });

  test('never overwrites a declared list, and lists what resolved to nothing', () => {
    const { root, read } = projectWith();
    const report = migrateChangelogs({ project: projectAt({ root }), write: true });

    expect(read('2026-01-02-declared.md')).toBe(ENTRIES['2026-01-02-declared.md']);
    expect(read('2026-01-03-nothing.md')).toBe(ENTRIES['2026-01-03-nothing.md']);
    expect(report.unresolved).toEqual(['changes/2026-01-03-nothing.md']);
    expect(report.declared).toBe(1);
  });

  test('a dry run reports the same and writes nothing', () => {
    const { root, read } = projectWith();
    const report = migrateChangelogs({ project: projectAt({ root }), write: false });

    expect(report.written).toEqual(['changes/2026-01-01-mention.md', 'changes/2026-01-04-bare.md']);
    expect(read('2026-01-01-mention.md')).toBe(ENTRIES['2026-01-01-mention.md']);
  });
});

describe('migrateChangelogs on CRLF entries', () => {
  test('a declared list is read, never given a second frontmatter; a new line keeps CRLF', () => {
    const root = mkdtempSync(join(tmpdir(), 'atlas-migrate-crlf-'));
    const declared =
      "---\r\ntitle: Kept\r\npackages: ['@acme/web']\r\n---\r\n\r\nThe `@acme/kernel` too.\r\n";
    const mention = '---\r\ntitle: Faster\r\n---\r\n\r\nThe `@acme/kernel` boots faster.\r\n';

    roots.push(root);
    mkdirSync(join(root, 'changes'));
    writeFileSync(join(root, 'changes', '2026-01-01-declared.md'), declared);
    writeFileSync(join(root, 'changes', '2026-01-02-mention.md'), mention);

    const report = migrateChangelogs({ project: projectAt({ root }), write: true });

    expect(report.declared).toBe(1);
    expect(report.written).toEqual(['changes/2026-01-02-mention.md']);
    expect(readFileSync(join(root, 'changes', '2026-01-01-declared.md'), 'utf8')).toBe(declared);
    expect(readFileSync(join(root, 'changes', '2026-01-02-mention.md'), 'utf8')).toBe(
      "---\r\ntitle: Faster\r\npackages: ['@acme/kernel']\r\n---\r\n\r\nThe `@acme/kernel` boots faster.\r\n",
    );
  });
});
