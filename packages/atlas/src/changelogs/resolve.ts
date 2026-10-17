import { directoryOf } from '@/common/package-map';
import type { IAtlasPackage } from '@/common/project-config';

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?/;
const TABLE_ROW_PATTERN = /^\s*\|(.*)\|\s*$/;
const TABLE_SEPARATOR_PATTERN = /^\s*\|[\s|:-]+\|\s*$/;

const byText = (left: string, right: string): number => {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
};

export const resolveAll = (opts: { values: string[]; packages: IAtlasPackage[] }): string[] => {
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
 * a name followed by more of a name (`@a/shop-other` for `@a/shop`) is no mention of it; a
 * sub-path (`@a/shop/core`) is.
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

export const splitFrontmatter = (text: string): { data: Record<string, unknown>; body: string } => {
  const matched = text.match(FRONTMATTER_PATTERN);

  if (!matched) {
    return { data: {}, body: text };
  }

  const parsed: unknown = Bun.YAML.parse(matched[1]);

  return { data: isRecord(parsed) ? parsed : {}, body: text.slice(matched[0].length) };
};

/**
 * The packages one changelog file names, by the first rule that hits: a `packages:` frontmatter
 * list, a Details table's `Package` column, npm-name mentions, then `packages/<dir>` paths. Only the
 * configured packages count, retired ones included; a file none of the four answer for resolves to
 * none - it never guesses. `changelogs migrate` writes what this finds, once, for a human to review;
 * nothing else reads prose (Project Contract v1, C3).
 */
export const resolveChangelogPackages = (opts: {
  text: string;
  packages: IAtlasPackage[];
}): string[] => {
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
};
