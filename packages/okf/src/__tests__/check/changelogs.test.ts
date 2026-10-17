import { afterAll, afterEach, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectChangelogProblems } from '../../check/changelogs.ts';
import { clearProjectConfig, useProjectConfig } from '../project.helper.ts';

afterEach(clearProjectConfig);

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const PACKAGES = [
  { dir: 'kernel', name: '@acme/kernel', aliases: [], retired: false },
  { dir: 'old', name: '@acme/old', aliases: [], retired: true },
];

/** A project with a `changes/` directory holding `entries`, its tags in a git repository. */
const project = (opts: { entries: Record<string, string>; tags?: string[] }): void => {
  const root = mkdtempSync(join(tmpdir(), 'okf-changelogs-'));

  roots.push(root);
  mkdirSync(join(root, 'changes'));

  for (const [file, text] of Object.entries(opts.entries)) {
    writeFileSync(join(root, 'changes', file), text);
  }

  const git = (args: string[]): void => {
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd: root,
      stdio: 'ignore',
    });
  };

  git(['init', '-q']);
  git(['commit', '-q', '--allow-empty', '-m', 'init']);

  for (const tag of opts.tags ?? []) {
    git(['tag', tag]);
  }

  useProjectConfig({
    root,
    config: { packages: PACKAGES, knowledge: { changelogs: 'changes' }, atlas: {} },
  });
};

const entry = (opts: { frontmatter: string }): string =>
  `---\ntitle: A change\n${opts.frontmatter}\n---\n\nThe change.\n`;

test('every dated entry declaring known npm names, retired ones included, passes', () => {
  project({
    entries: {
      '2026-01-01-a.md': entry({ frontmatter: "packages: ['@acme/kernel']" }),
      '2026-01-02-b.md': entry({ frontmatter: "packages: ['@acme/old', '@acme/kernel']" }),
      'index.md': '# Changelogs\n',
      'template.md': '---\ntitle: Template\n---\n',
    },
  });

  expect(collectChangelogProblems()).toEqual([]);
});

test('an entry without packages fails, pointing at migrate (positive control)', () => {
  project({ entries: { '2026-01-01-a.md': entry({ frontmatter: 'kind: fix' }) } });

  expect(collectChangelogProblems()).toEqual([
    'changelog: changes/2026-01-01-a.md declares no packages - add `packages: [<npm name>, ...]` (`vulcan x atlas changelogs migrate` fills it)',
  ]);
});

test('an explicit empty list is an entry about no package - repository tooling - and passes', () => {
  project({ entries: { '2026-01-01-a.md': entry({ frontmatter: 'packages: []' }) } });

  expect(collectChangelogProblems()).toEqual([]);
});

test('a CRLF entry is read like any other', () => {
  project({
    entries: {
      '2026-01-01-a.md': entry({ frontmatter: "packages: ['@acme/kernel']" }).replace(
        /\n/g,
        '\r\n',
      ),
    },
  });

  expect(collectChangelogProblems()).toEqual([]);
});

test('an unknown name fails, naming it (positive control)', () => {
  project({ entries: { '2026-01-01-a.md': entry({ frontmatter: "packages: ['kernel']" }) } });

  expect(collectChangelogProblems()).toEqual([
    "changelog: changes/2026-01-01-a.md names 'kernel', not a declared package's npm name",
  ]);
});

test('a release override must name a tag that exists', () => {
  project({
    entries: {
      '2026-01-01-a.md': entry({
        frontmatter: "packages: ['@acme/kernel']\nrelease: '@acme/kernel@1.0.0'",
      }),
      '2026-01-02-b.md': entry({
        frontmatter: "packages: ['@acme/kernel']\nrelease: '@acme/kernel@9.9.9'",
      }),
    },
    tags: ['kernel-v1.0.0'],
  });

  expect(collectChangelogProblems()).toEqual([
    "changelog: changes/2026-01-02-b.md: release '@acme/kernel@9.9.9' names no tag (kernel-v9.9.9)",
  ]);
});

test('no changelog directory declared: nothing to check', () => {
  useProjectConfig({ root: tmpdir(), config: { packages: PACKAGES } });

  expect(collectChangelogProblems()).toEqual([]);
});
