/**
 * Shared by the three wikis (IGNIS, ARDOR, VULCAN): a byte-identical copy in each, kept in step by
 * scripts/wiki-shared in VULCAN. Edit it there, never in a copy.
 *
 * The changelog feed, RSS 2.0: the XML is built here, with no dependency, from the parsed entries.
 * `writeChangelogFeed` (changelog-loader.ts) writes it as `changelog.xml` at build time.
 */
import { formatDate, type TChangelogEntry, type TVersionEntry } from './changelog-entries';

export type TFeedSite = { title: string; description: string; siteUrl: string };

const escapeXml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The feed: the dated entries as before, and the released version folders. A version still in progress has no
 * release date, so it is not in the feed; its date is `released:`, never the day it was written.
 */
export const changelogFeed = (opts: {
  site: TFeedSite;
  entries: TChangelogEntry[];
  versions?: TVersionEntry[];
}): string => {
  const base = opts.site.siteUrl.replace(/\/$/, '');
  const releases = (opts.versions ?? [])
    .filter((version): version is TVersionEntry & { released: string } => version.released !== null)
    .map(
      (version) =>
        `<item><title>${escapeXml(version.title)}</title><link>${base}${version.url}</link><guid isPermaLink="true">${base}${version.url}</guid><pubDate>${new Date(`${version.released}T12:00:00Z`).toUTCString()}</pubDate><description>${escapeXml(version.summary || formatDate(version.released))}</description><category>Release</category></item>`,
    )
    .join('');
  const items = opts.entries
    .map((entry) => {
      const kinds = entry.types
        .map((type) => `<category>${escapeXml(type.label)}</category>`)
        .join('');

      return `<item><title>${escapeXml(entry.title)}</title><link>${base}${entry.url}</link><guid isPermaLink="true">${base}${entry.url}</guid><pubDate>${new Date(`${entry.date}T12:00:00Z`).toUTCString()}</pubDate><description>${escapeXml(entry.summary || formatDate(entry.date))}</description>${kinds}</item>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${escapeXml(opts.site.title)}</title><link>${base}/changelogs/</link><description>${escapeXml(opts.site.description)}</description>${releases}${items}</channel></rss>\n`;
};
