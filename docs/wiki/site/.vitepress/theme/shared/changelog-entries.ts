/**
 * Shared by the three wikis (IGNIS, ARDOR, VULCAN): a byte-identical copy in each, kept in step by
 * scripts/wiki-shared in VULCAN. Edit it there, never in a copy.
 *
 * What the changelog index and the entry pages know about an entry, read from fields the entries already
 * have: the date from the file name (YYYY-MM-DD-slug.md), the title and the optional summary from the
 * frontmatter (else its description), the packages list, the optional `release: '<npm name>@<version>'`,
 * and the type from the `<Badge text="...">` line of the body (or an explicit `badges:` list). An entry
 * is a release overview when its frontmatter says `type: release`, its file name has `batch-overview`,
 * or its title ends in "(Overview)". This file is pure (no VitePress import) so a test can run it.
 */
export type TChangelogGroup =
  | 'releases'
  | 'features'
  | 'fixes'
  | 'security'
  | 'breaking'
  | 'behavior'
  | 'other';

export type TChangelogType = { label: string; group: TChangelogGroup };

export type TChangelogEntry = {
  url: string;
  slug: string;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  title: string;
  summary: string;
  /** The chips to show: one "Release" for an overview, else one per badge. */
  types: TChangelogType[];
  isRelease: boolean;
  packages: string[];
  /** The version this entry belongs to, or null. */
  version: string | null;
};

/** A version folder's page: the loader names it by its source (`/changelogs/0.4.8/log`); the wiki serves it at `/changelogs/0.4.8`. */
const VERSION_URL = /\/changelogs\/(\d+\.\d+\.\d+)(?:\/log)?$/;
const DATED = /^(\d{4}-\d{2}-\d{2})-(.+)$/;
const BADGE = /<Badge\b[^>]*?\btext="([^"]+)"/g;
const VERSION = /\b(\d+\.\d+\.\d+)\b/;

const TYPE_OF_BADGE: Record<string, TChangelogType> = {
  'new feature': { label: 'Feature', group: 'features' },
  enhancement: { label: 'Enhancement', group: 'features' },
  'bug fix': { label: 'Fix', group: 'fixes' },
  security: { label: 'Security', group: 'security' },
  'breaking change': { label: 'Breaking', group: 'breaking' },
  'behavior change': { label: 'Behavior', group: 'behavior' },
};

/** The order a chip list is shown in, and the one a single label is taken from. */
const GROUP_ORDER: TChangelogGroup[] = [
  'security',
  'breaking',
  'features',
  'fixes',
  'behavior',
  'other',
];

const typeOfBadge = (text: string): TChangelogType => {
  // "New Feature, not verified": the first words name the type, the rest is the author's note.
  const known = TYPE_OF_BADGE[text.split(',')[0].trim().toLowerCase()];

  return known ?? { label: text.split(',')[0].trim(), group: 'other' };
};

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * One version folder (`changelogs/<X.Y.Z>/log.md`) as the index and the feed know it. Only the frontmatter and the
 * first paragraph are read: no git, no manifest, so the file is the same in every wiki.
 */
export type TVersionEntry = {
  url: string;
  /** The stable the line releases: the folder name. */
  version: string;
  title: string;
  /** `YYYY-MM-DD` once the stable is out; null while the line is in progress. */
  released: string | null;
  /** The paragraph above the sections: what the release is. */
  summary: string;
  packages: string[];
  /** The line has a Breaking section: its page points to the migrate guide. */
  hasBreaking: boolean;
  /** The page as HTML; set only for the two the index shows in full. */
  html?: string;
};

const SECTION = /^## (.+?)\s*$/gm;
const RELEASED = /^\d{4}-\d{2}-\d{2}$/;

/** The text between the frontmatter and the first heading, as one line. */
const introOf = (src: string): string => {
  const body = src.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  const first = body.search(/^## /m);

  return (first === -1 ? body : body.slice(0, first)).replace(/\s+/g, ' ').trim();
};

/** A version folder's page as an entry; null for any other page. */
export const parseVersion = (opts: {
  url: string;
  frontmatter: Record<string, unknown>;
  src: string;
}): TVersionEntry | null => {
  const version = VERSION_URL.exec(opts.url.replace(/\.html$/, ''))?.[1];

  if (version === undefined) {
    return null;
  }

  // The frontmatter parser reads an unquoted `released: 2026-11-10` as a Date (UTC midnight); a quoted one is text.
  const date = opts.frontmatter.released;
  const released =
    date instanceof Date && !Number.isNaN(date.getTime())
      ? date.toISOString().slice(0, 10)
      : text(date);
  const packages = Array.isArray(opts.frontmatter.packages)
    ? opts.frontmatter.packages.filter((entry): entry is string => typeof entry === 'string')
    : [];

  return {
    url: `/changelogs/${version}`,
    version,
    title: text(opts.frontmatter.title) || version,
    released: RELEASED.test(released) ? released : null,
    summary: introOf(opts.src),
    packages,
    hasBreaking: [...opts.src.matchAll(SECTION)].some((match) => match[1] === 'Breaking'),
  };
};

const numbers = (version: string): number[] => version.split('.').map(Number);

/** Newest first, by version number. */
export const sortVersions = (versions: TVersionEntry[]): TVersionEntry[] =>
  [...versions].sort((a, b) => {
    const [left, right] = [numbers(a.version), numbers(b.version)];

    return right[0] - left[0] || right[1] - left[1] || right[2] - left[2];
  });

/**
 * What the index shows of the version folders, in the order it shows them: the latest released line in full, then
 * the line in progress, then the older released lines as a list of titles.
 */
export const shownVersions = (
  versions: TVersionEntry[],
): { latest?: TVersionEntry; inProgress?: TVersionEntry; older: TVersionEntry[] } => {
  const sorted = sortVersions(versions);
  const released = sorted.filter((entry) => entry.released !== null);

  return {
    latest: released[0],
    inProgress: sorted.find((entry) => entry.released === null),
    older: released.slice(1),
  };
};

export const parseEntry = (opts: {
  url: string;
  frontmatter: Record<string, unknown>;
  src: string;
}): TChangelogEntry | null => {
  const slug =
    opts.url
      .replace(/\.html$/, '')
      .split('/')
      .pop() ?? '';
  const dated = DATED.exec(slug);

  if (dated === null) {
    return null;
  }

  const title = text(opts.frontmatter.title);
  const isRelease =
    text(opts.frontmatter.type) === 'release' ||
    slug.includes('batch-overview') ||
    /\(overview\)\s*$/i.test(title);
  const explicit = Array.isArray(opts.frontmatter.badges)
    ? opts.frontmatter.badges.filter((entry): entry is string => typeof entry === 'string')
    : [];
  const badges =
    explicit.length > 0 ? explicit : [...opts.src.matchAll(BADGE)].map((match) => match[1]);
  const types = isRelease
    ? [{ label: 'Release', group: 'releases' as const }]
    : [
        ...new Map(
          badges.map((badge) => typeOfBadge(badge)).map((type) => [type.label, type]),
        ).values(),
      ].sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
  const release = text(opts.frontmatter.release);
  const packages = Array.isArray(opts.frontmatter.packages)
    ? opts.frontmatter.packages.filter((entry): entry is string => typeof entry === 'string')
    : [];

  return {
    url: opts.url.replace(/\.html$/, ''),
    slug,
    date: dated[1],
    title,
    summary: text(opts.frontmatter.summary) || text(opts.frontmatter.description),
    types,
    isRelease,
    packages,
    version: release.includes('@')
      ? release.slice(release.lastIndexOf('@') + 1)
      : (VERSION.exec(title)?.[1] ?? null),
  };
};

/** Newest first; on one day a release overview comes before the others, then the file name, descending. */
export const sortEntries = (entries: TChangelogEntry[]): TChangelogEntry[] =>
  [...entries].sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      Number(b.isRelease) - Number(a.isRelease) ||
      b.slug.localeCompare(a.slug),
  );

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "October 26, 2026" from an ISO date, without the time zone of the reader or the build machine. */
export const formatDate = (iso: string): string => {
  const [year, month, day] = iso.split('-').map(Number);

  return `${MONTHS[month - 1]} ${day}, ${year}`;
};

/** The filter tabs, in the order shown: a tab shows an entry when one of its types is in its group list. */
export const FILTERS: { id: string; label: string; groups: TChangelogGroup[] }[] = [
  { id: 'all', label: 'All', groups: [] },
  { id: 'releases', label: 'Releases', groups: ['releases'] },
  { id: 'features', label: 'Features', groups: ['features'] },
  { id: 'fixes', label: 'Fixes', groups: ['fixes'] },
  { id: 'security', label: 'Security', groups: ['security'] },
  { id: 'breaking', label: 'Breaking', groups: ['breaking'] },
];

export const matchesFilter = (entry: TChangelogEntry, id: string): boolean => {
  const filter = FILTERS.find((candidate) => candidate.id === id);

  return (
    filter === undefined ||
    filter.groups.length === 0 ||
    entry.types.some((type) => filter.groups.includes(type.group))
  );
};
