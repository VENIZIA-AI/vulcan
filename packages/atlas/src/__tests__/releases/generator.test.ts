import { describe, expect, spyOn, test } from 'bun:test';
import { ReleaseCompute } from '@/releases/compute';
import { AtlasReleases, runReleasesCommand } from '@/releases/generator';
import { ProjectConfig } from '@/common/project-config';
import { IGNIS_PACKAGES } from '../fixtures/ignis-packages';
import { ignisCommittedFileOf, IGNIS_HAS_HISTORY, IGNIS_ROOT } from '../ignis-root.helper';

const withFrontmatter = (opts: { frontmatter: string; body: string }): string =>
  `---\n${opts.frontmatter}\n---\n\n${opts.body}\n`;

describe('ReleaseCompute.kindOfChangelog', () => {
  test('reads the first badge text', () => {
    const text = '# Changelog\n\n<Badge type="tip" text="New Feature" />\n';

    expect(ReleaseCompute.kindOfChangelog({ text })).toBe('New Feature');
  });

  test('a file with no badge has no kind', () => {
    expect(ReleaseCompute.kindOfChangelog({ text: '# Changelog\n\nProse.\n' })).toBeNull();
  });
});

describe('ReleaseCompute.titleOfChangelog', () => {
  test('reads the frontmatter title', () => {
    const text = withFrontmatter({ frontmatter: 'title: A Real Title', body: '# Changelog' });

    expect(ReleaseCompute.titleOfChangelog({ text, file: '2026-01-01-thing.md' })).toBe(
      'A Real Title',
    );
  });

  test('falls back to the file stem rather than an empty title', () => {
    expect(
      ReleaseCompute.titleOfChangelog({ text: '# Changelog\n', file: '2026-01-01-thing.md' }),
    ).toBe('2026-01-01-thing');
  });
});

// The table IGNIS committed until it adopted 0.2.0 - read from history once it is gone.
const IGNIS_RELEASES = ignisCommittedFileOf({ path: '.agents/knowledge/reference/releases.json' });
const hasGeneratedTable = IGNIS_RELEASES !== undefined;
const IGNIS_PROJECT = ProjectConfig.toAtlasProject({
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
        records.map((record) => `${record.version} ${record.date} ${record.sha}`).sort();
      // packages/core became packages/core-server (one npm name, @venizia/ignis): the old table kept
      // its releases under 'core', they are core-server's history now. The old table's duplicate of
      // core 0.1.1 (the merge commit) is not a release.
      const tagged = (records: { version: string; sha: string; date: string }[] = []) =>
        records.filter((record) => !DUPLICATE_RELEASE_COMMITS.has(record.sha));
      const expected: Record<string, { version: string; date: string; sha: string }[]> = {
        ...committed.releases,
        'core-server': tagged([
          ...(committed.releases['core-server'] ?? []),
          ...(committed.releases.core ?? []),
        ]),
        'dev-configs': tagged(committed.releases['dev-configs']),
      };

      delete expected.core;

      // A subset, not equality: the committed table is frozen, IGNIS keeps releasing, and a release
      // newer than the table is no fault. What the table holds must come back unchanged.
      expect(Object.keys(computed.releases)).toEqual(expect.arrayContaining(Object.keys(expected)));

      for (const [dir, records] of Object.entries(expected)) {
        expect(spelled(computed.releases[dir]), dir).toEqual(
          expect.arrayContaining(spelled(records)),
        );
      }
    });

    test('every changelog falls after the same releases - but those the old table put at the end', () => {
      // The old table gave a release tagged on a branch merged later the "uncommitted" order (after
      // everything); a merged branch's release now takes the position of its merge.
      const stuck = Math.max(
        ...Object.values(committed.releases)
          .flat()
          .map((record) => record.order),
      );
      const committedOrder = new Map(
        Object.values(committed.releases)
          .flat()
          .filter((record) => record.order !== stuck && !DUPLICATE_RELEASE_COMMITS.has(record.sha))
          .map((record) => [record.sha, record.order]),
      );
      const computedOrder = new Map<string, number>(
        Object.values(computed.releases as Record<string, { sha: string; order: number }[]>)
          .flat()
          .map((record) => [record.sha, record.order]),
      );
      const entryOrder = new Map(committed.changelogs.map((entry) => [entry.id, entry.order]));
      const misplaced: string[] = [];

      // An entry written after the table was retired has no old position to compare with.
      for (const entry of (computed.changelogs as { id: string; order: number }[]).filter((item) =>
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
  },
);

describe('runReleasesCommand', () => {
  test('a subcommand word prints the usage naming it and exits 2; a flag is ignored', () => {
    const error = spyOn(console, 'error').mockImplementation(() => {});

    try {
      expect(runReleasesCommand({ command: 'gen' })).toBe(2);
      expect(error).toHaveBeenCalledWith(
        "usage: vulcan x atlas releases (no subcommand: 'gen' is not one)",
      );
      error.mockClear();
      // A flag gets past the argument check: whatever happens next (here, no manifest in a test) is not the usage.
      try {
        runReleasesCommand({ command: '--root' });
      } catch {
        // The real command reads the project; only the usage line matters here.
      }

      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});
