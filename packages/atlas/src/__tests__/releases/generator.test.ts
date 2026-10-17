import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AtlasReleases } from '@/releases/generator';
import { toAtlasProject } from '@/common/project-config';
import { IGNIS_PACKAGES } from '../fixtures/ignis-packages';
import { IGNIS_HAS_HISTORY, IGNIS_ROOT } from '../ignis-root.helper';

const tmpDirs: string[] = [];

const makeTmpDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'vulcan-atlas-releases-'));

  tmpDirs.push(dir);

  return dir;
};

afterAll(() => {
  for (const dir of tmpDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const withFrontmatter = (opts: { frontmatter: string; body: string }): string =>
  `---\n${opts.frontmatter}\n---\n\n${opts.body}\n`;

describe('AtlasReleases.parseReleaseSubject', () => {
  test('reads the package and the version out of a prerelease subject', () => {
    expect(
      AtlasReleases.parseReleaseSubject({
        subject: 'chore(kernel): release v0.2.0-21 [prerelease]',
      }),
    ).toEqual({ package: 'kernel', version: '0.2.0-21' });
  });

  test('reads a hyphenated package name and a patch mode', () => {
    expect(
      AtlasReleases.parseReleaseSubject({ subject: 'chore(core-server): release v0.1.5 [patch]' }),
    ).toEqual({ package: 'core-server', version: '0.1.5' });
  });

  test('reads a release subject that carries its issue number', () => {
    expect(
      AtlasReleases.parseReleaseSubject({
        subject: '[#80] chore(kernel): release v0.2.1-0 [prerelease]',
      }),
    ).toEqual({ package: 'kernel', version: '0.2.1-0' });
  });

  test('reads a release subject that carries several issue numbers', () => {
    expect(
      AtlasReleases.parseReleaseSubject({
        subject: '[#80][#81] chore(core-server): release v0.2.1 [patch]',
      }),
    ).toEqual({ package: 'core-server', version: '0.2.1' });
  });

  test('ignores a subject that is not a release commit', () => {
    expect(
      AtlasReleases.parseReleaseSubject({ subject: 'feat(atlas): the symbol tool' }),
    ).toBeUndefined();
  });

  test('ignores a release-shaped subject with no scope', () => {
    expect(
      AtlasReleases.parseReleaseSubject({ subject: 'chore: release v0.2.0-21 [prerelease]' }),
    ).toBeUndefined();
  });
});

describe('AtlasReleases.packagesOf', () => {
  test('a packages frontmatter list wins over everything else in the file', () => {
    const text = withFrontmatter({
      frontmatter: 'title: A change\npackages:\n  - kernel\n  - boot',
      body: '| Symbol | Change | Package |\n|---|---|---|\n| `x` | New | helpers |\n',
    });

    expect(AtlasReleases.packagesOf({ text, packages: IGNIS_PACKAGES })).toEqual([
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

    expect(AtlasReleases.packagesOf({ text, packages: IGNIS_PACKAGES })).toEqual([
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

    expect(AtlasReleases.packagesOf({ text, packages: IGNIS_PACKAGES })).toEqual([
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

    expect(AtlasReleases.packagesOf({ text, packages: IGNIS_PACKAGES })).toEqual([]);
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

    expect(AtlasReleases.packagesOf({ text, packages: IGNIS_PACKAGES })).toEqual(['kernel']);
  });

  test('body mentions map @venizia/ignis to core-server and the worker to core-worker', () => {
    const text = withFrontmatter({
      frontmatter: 'title: A change',
      body: 'Both `@venizia/ignis` and `@venizia/ignis-worker` changed, plus `@venizia/ignis-helpers/core`.',
    });

    expect(AtlasReleases.packagesOf({ text, packages: IGNIS_PACKAGES })).toEqual([
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

    expect(AtlasReleases.packagesOf({ text, packages: IGNIS_PACKAGES })).toEqual([]);
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

const IGNIS_RELEASES = join(IGNIS_ROOT, '.agents/knowledge/reference/releases.json');
const hasGeneratedTable = existsSync(IGNIS_RELEASES);
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
  config: { packages: IGNIS_PACKAGES, knowledge: { changelogs: 'docs/wiki/content/changelogs' } },
});

describe.skipIf(!hasGeneratedTable || !IGNIS_HAS_HISTORY)('AtlasReleases.check', () => {
  // Content, not bytes: 0.2.0-0 adds `packageMap`, and an `order` is a release count, not a position.
  test('reproduces every release, live package and changelog entry of the committed table', () => {
    const committed = JSON.parse(readFileSync(IGNIS_RELEASES, 'utf8'));
    const rendered = JSON.parse(AtlasReleases.render({ project: IGNIS_PROJECT }));
    const withoutOrder = (entries: { order?: number }[]) =>
      entries.map(({ order: _order, ...entry }) => entry);

    expect(rendered.livePackages).toEqual(committed.livePackages);
    const releasesWithoutOrder = (table: Record<string, { order?: number }[]>) =>
      Object.fromEntries(
        Object.entries(table).map(([name, records]) => [name, withoutOrder(records)]),
      );

    expect(releasesWithoutOrder(rendered.releases)).toEqual(
      releasesWithoutOrder(committed.releases),
    );

    // Orders are release counts now, positions before: what must hold is the window each changelog
    // falls in - after exactly the same releases as the committed table says.
    const releaseOrders = (table: { releases: Record<string, { sha: string; order: number }[]> }) =>
      new Map(
        Object.values(table.releases)
          .flat()
          .map(record => [record.sha, record.order]),
      );
    const committedReleases = releaseOrders(committed);
    const renderedReleases = releaseOrders(rendered);
    const committedChangelogs = new Map<string, number>(
      committed.changelogs.map((entry: { id: string; order: number }) => [entry.id, entry.order]),
    );
    const misplaced: string[] = [];

    for (const entry of rendered.changelogs as { id: string; order: number }[]) {
      for (const [sha, order] of renderedReleases) {
        const before = (committedChangelogs.get(entry.id) ?? 0) > (committedReleases.get(sha) ?? 0);

        if (before !== entry.order > order) {
          misplaced.push(`${entry.id} / ${sha}`);
        }
      }
    }

    expect(misplaced).toEqual([]);

    const explained = new Set(Object.keys(EXPLAINED_CHANGES));
    const unexplained = (entries: { id: string; order?: number }[]) =>
      withoutOrder(entries.filter(entry => !explained.has(entry.id)));

    expect(unexplained(rendered.changelogs)).toEqual(unexplained(committed.changelogs));

    for (const [id, packages] of Object.entries(EXPLAINED_CHANGES)) {
      expect(
        rendered.changelogs.find((entry: { id: string }) => entry.id === id)?.packages,
      ).toEqual(packages);
    }
  });

  test('reads stale once a release is dropped from the table', () => {
    const outputPath = join(makeTmpDir(), 'releases.json');

    writeFileSync(outputPath, AtlasReleases.render({ project: IGNIS_PROJECT }));
    expect(AtlasReleases.check({ project: IGNIS_PROJECT, outputPath })).toBe(true);

    const table = JSON.parse(readFileSync(outputPath, 'utf8'));
    const packageName = Object.keys(table.releases)[0];

    table.releases[packageName] = table.releases[packageName].slice(1);
    writeFileSync(outputPath, `${JSON.stringify(table, null, 2)}\n`);

    expect(AtlasReleases.check({ project: IGNIS_PROJECT, outputPath })).toBe(false);
  });
});

describe('AtlasReleases with project packages', () => {
  test('a retired package keeps its old changelog entries', () => {
    const text = withFrontmatter({
      frontmatter: 'title: The docs server',
      body: 'The `@venizia/ignis-docs-mcp` server answers search.',
    });

    expect(AtlasReleases.packagesOf({ text, packages: IGNIS_PACKAGES })).toEqual(['docs-mcp']);
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
        aliases: ['@venizia/ignis-core-worker'],
        retired: false,
      },
    ];

    expect(AtlasReleases.packagesOf({ text, packages })).toEqual(['core-worker']);
  });

  test('a mention of a longer name is not a mention of its prefix', () => {
    const text = withFrontmatter({
      frontmatter: 'title: Unknown',
      body: 'Uses `@venizia/ignis-unlisted` only.',
    });

    expect(AtlasReleases.packagesOf({ text, packages: IGNIS_PACKAGES })).toEqual([]);
  });

  test('a release subject is read with the configured template', () => {
    const pattern = toAtlasProject({
      root: '/r',
      config: { atlas: { releaseCommit: 'chore(release): v<version>' } },
    }).releaseCommit;

    expect(
      AtlasReleases.parseReleaseSubject({
        subject: 'chore(release): v0.1.0-2 [prerelease]',
        pattern,
      }),
    ).toEqual({ package: undefined, version: '0.1.0-2' });
  });
});
