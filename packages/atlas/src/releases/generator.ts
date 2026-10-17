#!/usr/bin/env bun
/**
 * Release table for the Atlas `version` and `changes` tools: every `chore(<package>): release
 * v<version>` commit in the history, and every dated changelog entry with the packages it names.
 * Read from `git log` and `docs/wiki/content/changelogs`, so no build is needed first.
 * Usage: bun scripts/atlas-releases.ts gen|check
 */
import { regenerateHintOf } from '@/common/regenerate-hint';
import { PROJECT_ROOT } from '@/common/project';
import { directoryOf } from '@/common/package-map';
import type { IPackageMapEntry } from '@/common/package-map';
import { readAtlasProject } from '@/common/project-config';
import type { IAtlasPackage, IAtlasProject } from '@/common/project-config';
import { compileReleaseTemplate } from './template';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

export const RELEASES_OUTPUT = resolve(PROJECT_ROOT, '.agents/knowledge/reference/releases.json');

const SHORT_SHA_LENGTH = 8;

/** A file the history does not carry yet: it sorts after every committed entry, so a fresh changelog is inside the newest window. */
const UNCOMMITTED_ORDER = Number.MAX_SAFE_INTEGER;

/** One published version of one package, as its release commit recorded it. */
export interface IReleaseRecord {
  version: string;
  date: string;
  sha: string;
  /** Position of the release commit in first-parent history, oldest first - the only ordering that separates two releases of one day. */
  order: number;
}

/** One dated changelog entry; `id` is the citation id `search` and `get` already use. */
export interface IChangelogRecord {
  id: string;
  file: string;
  date: string;
  title: string;
  packages: string[];
  kind: string | null;
  /** Position of the commit that ADDED the file, oldest first; `-1` when the file is not committed yet. */
  order: number;
}

export interface IReleaseTable {
  /** The package directories that exist today; `releases` also holds retired ones, whose history stays readable. */
  livePackages: string[];
  releases: Record<string, IReleaseRecord[]>;
  changelogs: IChangelogRecord[];
  /** Every package's directory, npm name and other names - the tools resolve a queried name through it. */
  packageMap: IPackageMapEntry[];
}

interface IReleaseSubject {
  /** `undefined` for a release train's commit (no `<dir>` in the template): it releases every live package. */
  package: string | undefined;
  version: string;
}

/** IGNIS's form, the schema default: `[#80] chore(kernel): release v0.2.1-0 [prerelease]`. */
const DEFAULT_RELEASE_PATTERN = compileReleaseTemplate({
  template: '[#<issue>] chore(<dir>): release v<version>',
});

const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---\n?/;
const DATE_PREFIX_PATTERN = /^(\d{4}-\d{2}-\d{2})-/;
const BADGE_TEXT_PATTERN = /<Badge[^>]*\stext="([^"]*)"/;
const TABLE_ROW_PATTERN = /^\s*\|(.*)\|\s*$/;
const TABLE_SEPARATOR_PATTERN = /^\s*\|[\s|:-]+\|\s*$/;

const byText = (left: string, right: string): number => {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
};

const resolveAll = (opts: { values: string[]; packages: IAtlasPackage[] }): string[] => {
  const resolved = opts.values
    .map(value => directoryOf({ value, packages: opts.packages }))
    .filter((name): name is string => name !== undefined);

  return [...new Set(resolved)].sort(byText);
};

const cellsOf = (line: string): string[] => {
  const matched = line.match(TABLE_ROW_PATTERN);

  return matched ? matched[1].split('|').map(cell => cell.trim()) : [];
};

/**
 * Every value under a `Package` column, across every table in the body. A row whose cell count
 * differs from its header's contributes nothing - a stray `|` shifts the column, it never renames it.
 */
const packageColumnValuesOf = (opts: { body: string }): string[] => {
  const lines = opts.body.split('\n');
  const values: string[] = [];
  let columnIndex = -1;
  let columnCount = 0;

  for (const line of lines) {
    const cells = cellsOf(line);

    if (cells.length === 0) {
      columnIndex = -1;
      continue;
    }

    if (TABLE_SEPARATOR_PATTERN.test(line)) {
      continue;
    }

    const headerIndex = cells.findIndex(cell => cell.toLowerCase() === 'package');

    if (columnIndex === -1 || headerIndex !== -1) {
      columnIndex = headerIndex;
      columnCount = cells.length;
      continue;
    }

    if (cells.length === columnCount) {
      values.push(cells[columnIndex]);
    }
  }

  return values;
};

const escapeLiteral = (opts: { text: string }): string =>
  opts.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Every npm-name mention anywhere in the body, as the names themselves: each package's name, and
 * each alias spelled as a npm name (an old or a misspelled one a changelog used). Longest first, and
 * a name followed by more of a name (`@a/ignis-other` for `@a/ignis`) is no mention of it; a
 * sub-path (`@a/ignis/core`) is.
 */
const bodyMentionsOf = (opts: { body: string; packages: IAtlasPackage[] }): string[] => {
  const names = opts.packages
    .flatMap(entry => [entry.name, ...entry.aliases.filter(alias => alias.startsWith('@'))])
    .sort((left, right) => right.length - left.length);

  if (names.length === 0) {
    return [];
  }

  const pattern = new RegExp(
    `(?:${names.map(name => escapeLiteral({ text: name })).join('|')})(?![a-z0-9-])`,
    'g',
  );

  return [...opts.body.matchAll(pattern)].map(match => match[0]);
};

/** `packages/<dir>`, the heading convention every changelog before 2026-09 used to name its package. */
const PACKAGE_PATH_PATTERN = /packages\/([a-z0-9-]+)/g;

const bodyPathsOf = (opts: { body: string }): string[] =>
  [...opts.body.matchAll(PACKAGE_PATH_PATTERN)].map(match => match[1]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const splitFrontmatter = (text: string): { data: Record<string, unknown>; body: string } => {
  const matched = text.match(FRONTMATTER_PATTERN);

  if (!matched) {
    return { data: {}, body: text };
  }

  const parsed: unknown = Bun.YAML.parse(matched[1]);

  return { data: isRecord(parsed) ? parsed : {}, body: text.slice(matched[0].length) };
};

export class AtlasReleases {
  /** The project `vulcan x` handed over; a test passes its own. */
  static render(opts: { project?: IAtlasProject } = {}): string {
    const project = opts.project ?? readAtlasProject();
    const table: IReleaseTable = {
      livePackages: AtlasReleases.livePackagesOf({ project }),
      releases: AtlasReleases.releasesOf({ project }),
      changelogs: AtlasReleases.changelogsOf({ project }),
      packageMap: project.packages.map(entry => ({
        dir: entry.dir,
        name: entry.name,
        aliases: entry.aliases,
      })),
    };

    return `${JSON.stringify(table, null, 2)}\n`;
  }

  /** The configured packages that are not retired, sorted. */
  static livePackagesOf(opts: { project: IAtlasProject }): string[] {
    return opts.project.packages
      .filter(entry => !entry.retired)
      .map(entry => entry.dir)
      .sort(byText);
  }

  static check(opts: { project?: IAtlasProject; outputPath?: string } = {}): boolean {
    const outputPath = opts.outputPath ?? RELEASES_OUTPUT;
    const expected = AtlasReleases.render({ project: opts.project });
    const actual = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : '';

    return expected.trim() === actual.trim();
  }

  /** `undefined` for any subject the release template does not read; `pattern` defaults to IGNIS's form. */
  static parseReleaseSubject(opts: {
    subject: string;
    pattern?: RegExp;
  }): IReleaseSubject | undefined {
    const groups = (opts.pattern ?? DEFAULT_RELEASE_PATTERN).exec(opts.subject)?.groups;

    if (groups?.version === undefined) {
      return undefined;
    }

    return { package: groups.dir, version: groups.version };
  }

  /**
   * The packages one changelog file names, by the first rule that hits: a `packages:` frontmatter
   * list, a Details table's `Package` column, npm-name mentions, then `packages/<dir>` paths. Only
   * the configured packages count, retired ones included; a file none of the four answer for
   * resolves to none - the generator never guesses one.
   */
  static packagesOf(opts: { text: string; packages: IAtlasPackage[] }): string[] {
    const { data, body } = splitFrontmatter(opts.text);
    const { packages } = opts;

    const listed: unknown[] = Array.isArray(data.packages) ? data.packages : [];
    const declared = resolveAll({
      values: listed.filter((item): item is string => typeof item === 'string'),
      packages,
    });

    if (declared.length > 0) {
      return declared;
    }

    const tabled = resolveAll({ values: packageColumnValuesOf({ body }), packages });

    if (tabled.length > 0) {
      return tabled;
    }

    const mentioned = resolveAll({ values: bodyMentionsOf({ body, packages }), packages });

    if (mentioned.length > 0) {
      return mentioned;
    }

    return resolveAll({ values: bodyPathsOf({ body }), packages });
  }

  /** The first `<Badge ... text="X" />` in the file, or `null` when it carries none. */
  static kindOf(opts: { text: string }): string | null {
    const matched = opts.text.match(BADGE_TEXT_PATTERN);

    return matched ? matched[1] : null;
  }

  /** The frontmatter `title`, falling back to the file stem - never blank. */
  static titleOf(opts: { text: string; file: string }): string {
    const { data } = splitFrontmatter(opts.text);

    if (typeof data.title === 'string' && data.title.length > 0) {
      return data.title;
    }

    return opts.file.replace(/\.md$/, '');
  }

  /** Newest first per package, in `git log` order; the package keys are sorted, so the file is byte-identical on every machine. */
  private static releasesOf(opts: { project: IAtlasProject }): Record<string, IReleaseRecord[]> {
    const repoRoot = opts.project.root;
    // Every subject: the configured template, not a fixed grep, decides what a release commit is.
    const log = spawnSync('git', ['log', '--format=%H|%ad|%s', '--date=short'], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });

    if (log.status !== 0) {
      throw new Error(`[atlas-releases] git log exited ${log.status}\n${log.stderr ?? ''}`);
    }

    const byPackage = new Map<string, IReleaseRecord[]>();
    const lines = (log.stdout ?? '').split('\n').filter(line => line.length > 0);
    const order = AtlasReleases.commitOrderOf({ repoRoot });
    const live = AtlasReleases.livePackagesOf({ project: opts.project });

    for (const line of lines) {
      const [hash, date, ...rest] = line.split('|');
      const parsed = AtlasReleases.parseReleaseSubject({
        subject: rest.join('|'),
        pattern: opts.project.releaseCommit,
      });

      if (!parsed) {
        continue;
      }

      // A release train's commit names no directory: it releases every live package at once.
      for (const name of parsed.package === undefined ? live : [parsed.package]) {
        const records = byPackage.get(name) ?? [];

        records.push({
          version: parsed.version,
          date,
          sha: hash.slice(0, SHORT_SHA_LENGTH),
          order: order.get(hash) ?? UNCOMMITTED_ORDER,
        });
        byPackage.set(name, records);
      }
    }

    const sorted: Record<string, IReleaseRecord[]> = {};
    const names = [...byPackage.keys()].sort(byText);

    for (const name of names) {
      sorted[name] = byPackage.get(name) ?? [];
    }

    return sorted;
  }

  /** Every commit of first-parent history mapped to its position, oldest first. One `git log`, reused by both collectors. */
  private static commitOrderOf(opts: { repoRoot: string }): Map<string, number> {
    const log = spawnSync('git', ['rev-list', '--first-parent', '--reverse', 'HEAD'], {
      cwd: opts.repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });

    if (log.status !== 0) {
      throw new Error(`[atlas-releases] git rev-list exited ${log.status}\n${log.stderr ?? ''}`);
    }

    const order = new Map<string, number>();
    const hashes = (log.stdout ?? '').split('\n').filter(line => line.length > 0);

    hashes.forEach((hash, index) => order.set(hash, index));

    return order;
  }

  /** The position of the commit that added each changelog file, keyed by file name. */
  private static changelogOrderOf(opts: {
    repoRoot: string;
    directory: string;
  }): Map<string, number> {
    const order = AtlasReleases.commitOrderOf({ repoRoot: opts.repoRoot });
    const log = spawnSync(
      'git',
      [
        'log',
        '--first-parent',
        '--diff-filter=A',
        '--name-only',
        '--format=commit %H',
        '--',
        relative(opts.repoRoot, opts.directory),
      ],
      { cwd: opts.repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );

    if (log.status !== 0) {
      throw new Error(`[atlas-releases] git log --diff-filter=A exited ${log.status}`);
    }

    const byFile = new Map<string, number>();
    let current = UNCOMMITTED_ORDER;
    const lines = (log.stdout ?? '').split('\n');

    for (const line of lines) {
      if (line.startsWith('commit ')) {
        current = order.get(line.slice('commit '.length).trim()) ?? UNCOMMITTED_ORDER;
        continue;
      }

      const file = line.trim().split('/').pop();

      if (file && line.endsWith('.md') && !byFile.has(file)) {
        byFile.set(file, current);
      }
    }

    return byFile;
  }

  /**
   * Every changelog file except `index.md`, newest first. A file with no `YYYY-MM-DD` prefix
   * (`template.md`, `planned-schema-migrator.md`) is not a dated entry: it can never fall inside a
   * release window, so it is left out rather than carried with an invented date.
   */
  private static changelogsOf(opts: { project: IAtlasProject }): IChangelogRecord[] {
    const directory = opts.project.knowledge.changelogs;

    // No `knowledge.changelogs`: the project keeps no changelog, so no entry falls in any window.
    if (directory === undefined || !existsSync(directory)) {
      return [];
    }

    const files = readdirSync(directory)
      .filter(file => file.endsWith('.md') && file !== 'index.md')
      .sort(byText)
      .reverse();

    const records: IChangelogRecord[] = [];
    const order = AtlasReleases.changelogOrderOf({ repoRoot: opts.project.root, directory });

    for (const file of files) {
      const dated = file.match(DATE_PREFIX_PATTERN);

      if (!dated) {
        continue;
      }

      const text = readFileSync(resolve(directory, file), 'utf8');

      records.push({
        id: `changelog:${file.replace(/\.md$/, '')}`,
        file,
        date: dated[1],
        title: AtlasReleases.titleOf({ text, file }),
        packages: AtlasReleases.packagesOf({ text, packages: opts.project.packages }),
        kind: AtlasReleases.kindOf({ text }),
        order: order.get(file) ?? UNCOMMITTED_ORDER,
      });
    }

    return records;
  }
}

export const runReleasesCommand = (opts: { command?: string }): number => {
  switch (opts.command) {
    case 'gen': {
      const rendered = AtlasReleases.render();

      writeFileSync(RELEASES_OUTPUT, rendered);
      const table: IReleaseTable = JSON.parse(rendered);
      const unresolved = table.changelogs.filter(entry => entry.packages.length === 0).length;

      console.log(`wrote ${RELEASES_OUTPUT}`);
      console.log(
        `${table.changelogs.length} changelog entries, ${unresolved} resolving to no package`,
      );

      return 0;
    }

    case 'check': {
      if (AtlasReleases.check()) {
        console.log('fresh .agents/knowledge/reference/releases.json');

        return 0;
      }

      console.error(
        'stale .agents/knowledge/reference/releases.json - the release table drifted; ' +
          regenerateHintOf({ command: 'releases' }),
      );

      return 1;
    }

    default: {
      console.error('usage: vulcan x atlas releases gen|check');

      return 2;
    }
  }
};
