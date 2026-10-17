import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveChangelogPackages } from '@/changelogs';
import { AtlasReleases } from '@/releases/generator';
import { toAtlasProject } from '@/common/project-config';
import { IGNIS_PACKAGES } from '../fixtures/ignis-packages';
import {
  ignisCommittedFileOf,
  ignisFileAt,
  IGNIS_HAS_HISTORY,
  ignisRevisionWithOf,
  IGNIS_ROOT,
} from '../ignis-root.helper';

const withFrontmatter = (opts: { frontmatter: string; body: string }): string =>
  `---\n${opts.frontmatter}\n---\n\n${opts.body}\n`;

describe('resolveChangelogPackages - what migrate writes', () => {
  test('a packages frontmatter list wins over everything else in the file', () => {
    const text = withFrontmatter({
      frontmatter: 'title: A change\npackages:\n  - kernel\n  - boot',
      body: '| Symbol | Change | Package |\n|---|---|---|\n| `x` | New | helpers |\n',
    });

    expect(resolveChangelogPackages({ text, packages: IGNIS_PACKAGES })).toEqual([
      'boot',
      'kernel',
    ]);
  });

  test('a Details table Package column names the packages, de-duplicated and sorted', () => {
    const text = withFrontmatter({
      frontmatter: 'title: A change',
      body: [
        '| Symbol | Change | Package |',
        '|---|---|---|',
        '| `a` | New | kernel |',
        '| `b` | New | core-server |',
        '| `c` | New | kernel |',
      ].join('\n'),
    });

    expect(resolveChangelogPackages({ text, packages: IGNIS_PACKAGES })).toEqual([
      'core-server',
      'kernel',
    ]);
  });

  test('a Package column cell spelt as a scoped npm name maps back to its directory', () => {
    const text = withFrontmatter({
      frontmatter: 'title: A change',
      body: [
        '| Symbol | Change | Package |',
        '|---|---|---|',
        '| `a` | New | `@venizia/ignis` |',
        '| `b` | New | `@venizia/ignis-worker` |',
      ].join('\n'),
    });

    expect(resolveChangelogPackages({ text, packages: IGNIS_PACKAGES })).toEqual([
      'core-server',
      'core-worker',
    ]);
  });

  test('a Package column cell that names no package at all is dropped, not guessed', () => {
    const text = withFrontmatter({
      frontmatter: 'title: A change',
      body: [
        '| Symbol | Change | Package |',
        '|---|---|---|',
        '| `a` | New | Makefile |',
        '| `b` | New | `.agents/knowledge/reference` |',
      ].join('\n'),
    });

    expect(resolveChangelogPackages({ text, packages: IGNIS_PACKAGES })).toEqual([]);
  });

  test('a table wins over a body mention - the first rule that hits is the answer', () => {
    const text = withFrontmatter({
      frontmatter: 'title: A change',
      body: [
        'Import it from `@venizia/ignis-helpers`.',
        '',
        '| Symbol | Change | Package |',
        '|---|---|---|',
        '| `a` | New | kernel |',
      ].join('\n'),
    });

    expect(resolveChangelogPackages({ text, packages: IGNIS_PACKAGES })).toEqual(['kernel']);
  });

  test('body mentions map @venizia/ignis to core-server and the worker to core-worker', () => {
    const text = withFrontmatter({
      frontmatter: 'title: A change',
      body: 'Both `@venizia/ignis` and `@venizia/ignis-worker` changed, plus `@venizia/ignis-helpers/core`.',
    });

    expect(resolveChangelogPackages({ text, packages: IGNIS_PACKAGES })).toEqual([
      'core-server',
      'core-worker',
      'helpers',
    ]);
  });

  test('a file that names no package resolves to none', () => {
    const text = withFrontmatter({
      frontmatter: 'title: A change',
      body: 'Prose with no package name and no details table.',
    });

    expect(resolveChangelogPackages({ text, packages: IGNIS_PACKAGES })).toEqual([]);
  });
});

describe('AtlasReleases.kindOf', () => {
  test('reads the first badge text', () => {
    const text = '# Changelog\n\n<Badge type="tip" text="New Feature" />\n';

    expect(AtlasReleases.kindOf({ text })).toBe('New Feature');
  });

  test('a file with no badge has no kind', () => {
    expect(AtlasReleases.kindOf({ text: '# Changelog\n\nProse.\n' })).toBeNull();
  });
});

describe('AtlasReleases.titleOf', () => {
  test('reads the frontmatter title', () => {
    const text = withFrontmatter({ frontmatter: 'title: A Real Title', body: '# Changelog' });

    expect(AtlasReleases.titleOf({ text, file: '2026-01-01-thing.md' })).toBe('A Real Title');
  });

  test('falls back to the file stem rather than an empty title', () => {
    expect(AtlasReleases.titleOf({ text: '# Changelog\n', file: '2026-01-01-thing.md' })).toBe(
      '2026-01-01-thing',
    );
  });
});

// The table IGNIS committed until it adopted 0.2.0 - read from history once it is gone.
const IGNIS_RELEASES = ignisCommittedFileOf({ path: '.agents/knowledge/reference/releases.json' });
const hasGeneratedTable = IGNIS_RELEASES !== undefined;
/**
 * Where 0.2.0-0 answers differently from IGNIS's committed table, and why: `@venizia/dev-configs`
 * mentions now count (the old pattern knew `@venizia/ignis...` only), so a dev-configs changelog
 * names dev-configs, and its mentions win over `packages/<dir>` paths (the first rule that hits).
 */
const EXPLAINED_CHANGES: Record<string, string[]> = {
  'changelog:2026-10-17-oxlint-lenient-fallback': ['dev-configs'],
  'changelog:2026-10-17-lint-ignore-and-testing-helpers': ['dev-configs'],
  'changelog:2026-10-17-dev-configs-house-rules': ['dev-configs'],
  'changelog:2026-10-16-oxlint-oxfmt-migration': ['dev-configs'],
  'changelog:2026-10-16-dev-configs-browser-tier': ['dev-configs'],
  'changelog:2026-10-16-bun-tsconfig-extends': ['dev-configs'],
  'changelog:2026-07-05-unified-repository-connectors': ['core-server', 'dev-configs', 'helpers'],
  'changelog:2026-03-31-typescript-6-and-toolchain': ['dev-configs', 'inversion'],
};

const IGNIS_PROJECT = toAtlasProject({
  root: IGNIS_ROOT,
  manifest: {
    schemaVersion: 1,
    packages: IGNIS_PACKAGES,
    knowledge: { changelogs: 'docs/wiki/content/changelogs' },
  },
});

/**
 * A release the old table counted twice: the merge 3a10737d repeats core 0.1.1's release subject, and
 * the old subject matcher took it for a second release. The tag names the release commit, 6c2d31b1.
 */
const DUPLICATE_RELEASE_COMMITS = new Set(['3a10737d']);

describe.skipIf(!hasGeneratedTable || !IGNIS_HAS_HISTORY)(
  'releases computed from IGNIS tags (D1)',
  () => {
    const committed: {
      releases: Record<string, { version: string; date: string; sha: string; order: number }[]>;
      changelogs: { id: string; file: string; packages: string[]; order: number }[];
    } =
      IGNIS_RELEASES === undefined ? { releases: {}, changelogs: [] } : JSON.parse(IGNIS_RELEASES);
    const computed = JSON.parse(AtlasReleases.render({ project: IGNIS_PROJECT }));

    test('every committed release comes back from its tag, with its date and commit', () => {
      const spelled = (records: { version: string; date: string; sha: string }[] = []) =>
        records.map(record => `${record.version} ${record.date} ${record.sha}`).sort();
      // packages/core became packages/core-server (one npm name, @venizia/ignis): the old table kept
      // its releases under 'core', they are core-server's history now. The old table's duplicate of
      // core 0.1.1 (the merge commit) is not a release.
      const tagged = (records: { version: string; sha: string; date: string }[] = []) =>
        records.filter(record => !DUPLICATE_RELEASE_COMMITS.has(record.sha));
      const expected: Record<string, { version: string; date: string; sha: string }[]> = {
        ...committed.releases,
        'core-server': tagged([
          ...(committed.releases['core-server'] ?? []),
          ...(committed.releases.core ?? []),
        ]),
        'dev-configs': tagged(committed.releases['dev-configs']),
      };

      delete expected.core;

      expect(Object.keys(computed.releases).sort()).toEqual(Object.keys(expected).sort());

      for (const [dir, records] of Object.entries(expected)) {
        expect(spelled(computed.releases[dir]), dir).toEqual(spelled(records));
      }
    });

    test('every changelog falls after the same releases - but those the old table put at the end', () => {
      // The old table gave a release tagged on a branch merged later the "uncommitted" order (after
      // everything); a merged branch's release now takes the position of its merge.
      const stuck = Math.max(
        ...Object.values(committed.releases)
          .flat()
          .map(record => record.order),
      );
      const committedOrder = new Map(
        Object.values(committed.releases)
          .flat()
          .filter(record => record.order !== stuck && !DUPLICATE_RELEASE_COMMITS.has(record.sha))
          .map(record => [record.sha, record.order]),
      );
      const computedOrder = new Map<string, number>(
        Object.values(computed.releases as Record<string, { sha: string; order: number }[]>)
          .flat()
          .map(record => [record.sha, record.order]),
      );
      const entryOrder = new Map(committed.changelogs.map(entry => [entry.id, entry.order]));
      const misplaced: string[] = [];

      // An entry written after the table was retired has no old position to compare with.
      for (const entry of (computed.changelogs as { id: string; order: number }[]).filter(item =>
        entryOrder.has(item.id),
      )) {
        for (const [sha, order] of committedOrder) {
          const before = (entryOrder.get(entry.id) ?? 0) > order;
          const now = entry.order > (computedOrder.get(sha) ?? 0);

          if (before !== now) {
            misplaced.push(`${entry.id} / ${sha}`);
          }
        }
      }

      expect(committedOrder.size).toBeGreaterThan(600);
      expect(misplaced).toEqual([]);
    });

    test('what migrate will write: the committed packages, except the explained changes', () => {
      // Read as IGNIS had them beside the table - before `migrate` wrote their `packages:` lists.
      const revision = ignisRevisionWithOf({ path: '.agents/knowledge/reference/releases.json' });

      for (const entry of committed.changelogs) {
        const path = join('docs/wiki/content/changelogs', entry.file);
        const changelog =
          (revision === undefined ? undefined : ignisFileAt({ revision, path })) ??
          readFileSync(join(IGNIS_ROOT, path), 'utf8');

        expect(
          resolveChangelogPackages({ text: changelog, packages: IGNIS_PACKAGES }),
          entry.id,
        ).toEqual(EXPLAINED_CHANGES[entry.id] ?? entry.packages);
      }
    });
  },
);

describe('AtlasReleases with project packages', () => {
  test('a retired package keeps its old changelog entries', () => {
    const text = withFrontmatter({
      frontmatter: 'title: The docs server',
      body: 'The `@venizia/ignis-docs-mcp` server answers search.',
    });

    expect(resolveChangelogPackages({ text, packages: IGNIS_PACKAGES })).toEqual(['docs-mcp']);
  });

  test('an alias spelled as a npm name counts as a mention of its package', () => {
    const text = withFrontmatter({
      frontmatter: 'title: Workers',
      body: 'Ships `@venizia/ignis-core-worker` builds.',
    });
    const packages = [
      {
        dir: 'core-worker',
        name: '@venizia/ignis-worker',
        path: 'packages/core-worker',
        aliases: ['@venizia/ignis-core-worker'],
        retired: false,
      },
    ];

    expect(resolveChangelogPackages({ text, packages })).toEqual(['core-worker']);
  });

  test('a mention of a longer name is not a mention of its prefix', () => {
    const text = withFrontmatter({
      frontmatter: 'title: Unknown',
      body: 'Uses `@venizia/ignis-unlisted` only.',
    });

    expect(resolveChangelogPackages({ text, packages: IGNIS_PACKAGES })).toEqual([]);
  });
});

describe('AtlasReleases.packagesOf reads the declared list only (C3)', () => {
  test('prose names no package any more - a Package column without a declared list is none', () => {
    const text = withFrontmatter({
      frontmatter: 'title: A change',
      body: '| Package | Change |\n|---|---|\n| kernel | faster |',
    });

    expect(AtlasReleases.packagesOf({ text, packages: IGNIS_PACKAGES })).toEqual([]);
  });

  test('a declared list of npm names resolves to the packages it names', () => {
    const text = withFrontmatter({
      frontmatter: "title: A change\npackages: ['@venizia/ignis', '@venizia/ignis-docs-mcp']",
      body: 'Body.',
    });

    expect(AtlasReleases.packagesOf({ text, packages: IGNIS_PACKAGES })).toEqual([
      'core-server',
      'docs-mcp',
    ]);
  });
});
