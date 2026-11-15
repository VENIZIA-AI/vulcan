import { describe, expect, test } from 'bun:test';
import {
  FILTERS,
  formatDate,
  matchesFilter,
  parseEntry,
  demoteHeadings,
  parseVersion,
  plainText,
  releasedOf,
  shownVersions,
  sortVersions,
  sortEntries,
} from '../../../docs/wiki/site/.vitepress/theme/shared/changelog-entries.ts';
import { changelogFeed } from '../../../docs/wiki/site/.vitepress/theme/shared/changelog-feed.ts';

const entry = (opts: { slug: string; frontmatter?: Record<string, unknown>; src?: string }) =>
  parseEntry({
    url: `/changelogs/${opts.slug}`,
    frontmatter: {
      title: 'A title',
      description: 'A description.',
      packages: ['@x/core'],
      ...opts.frontmatter,
    },
    src: opts.src ?? '',
  });

describe('parseEntry', () => {
  test('reads the date from the file name, and the card text from the summary or the description', () => {
    const plain = entry({ slug: '2026-10-26-thing' });
    const summed = entry({ slug: '2026-10-26-thing', frontmatter: { summary: 'Better text.' } });

    expect(plain).toMatchObject({
      date: '2026-10-26',
      slug: '2026-10-26-thing',
      summary: 'A description.',
    });
    expect(summed?.summary).toBe('Better text.');
  });

  test('a file that is not a dated entry (index, template) is not an entry', () => {
    expect(entry({ slug: 'index' })).toBeNull();
    expect(entry({ slug: 'template' })).toBeNull();
  });

  test('the types come from the Badge line, ordered security first, with an author note dropped', () => {
    const parsed = entry({
      slug: '2026-10-26-x',
      src: '<Badge type="info" text="Bug Fix" /> <Badge type="danger" text="Security" /> <Badge type="tip" text="New Feature, not verified" />',
    });

    expect(parsed?.types.map((type) => type.label)).toEqual(['Security', 'Feature', 'Fix']);
  });

  test('explicit badges in the frontmatter win over the markup', () => {
    const parsed = entry({
      slug: '2026-10-26-x',
      frontmatter: { badges: ['Breaking Change'] },
      src: '<Badge text="Bug Fix" />',
    });

    expect(parsed?.types).toEqual([{ label: 'Breaking', group: 'breaking' }]);
  });

  test('a release overview is its own type, by frontmatter, file name or title', () => {
    for (const parsed of [
      entry({ slug: '2026-10-26-x', frontmatter: { type: 'release' } }),
      entry({ slug: '2026-10-25-vulcan-0-4-5-batch-overview' }),
      entry({ slug: '2026-10-25-y', frontmatter: { title: 'VULCAN 0.4.5: Things (Overview)' } }),
    ]) {
      expect(parsed?.isRelease).toBe(true);
      expect(parsed?.types).toEqual([{ label: 'Release', group: 'releases' }]);
    }
  });

  test('the version is the release override, else the first x.y.z of the title', () => {
    expect(
      entry({ slug: '2026-10-26-x', frontmatter: { release: '@x/core@1.2.3', title: 'v 9.9.9' } })
        ?.version,
    ).toBe('1.2.3');
    expect(
      entry({ slug: '2026-10-26-x', frontmatter: { title: 'VULCAN 0.4.5: A thing' } })?.version,
    ).toBe('0.4.5');
    expect(entry({ slug: '2026-10-26-x' })?.version).toBeNull();
  });

  test('packages are the frontmatter list, empty when there is none', () => {
    expect(entry({ slug: '2026-10-26-x' })?.packages).toEqual(['@x/core']);
    expect(entry({ slug: '2026-10-26-x', frontmatter: { packages: undefined } })?.packages).toEqual(
      [],
    );
  });
});

describe('sortEntries and the filters', () => {
  const list = [
    entry({ slug: '2026-10-25-a', src: '<Badge text="Bug Fix" />' }),
    entry({ slug: '2026-10-26-b', src: '<Badge text="Security" />' }),
    entry({ slug: '2026-10-26-vulcan-batch-overview' }),
    entry({ slug: '2026-10-26-a', src: '<Badge text="New Feature" />' }),
  ].filter((value) => value !== null);

  test('newest first; on one day an overview first, then the file name descending', () => {
    expect(sortEntries(list).map((value) => value.slug)).toEqual([
      '2026-10-26-vulcan-batch-overview',
      '2026-10-26-b',
      '2026-10-26-a',
      '2026-10-25-a',
    ]);
  });

  test('a tab shows the entries of its groups; All shows everything', () => {
    const shown = (id: string) =>
      list.filter((value) => matchesFilter(value, id)).map((value) => value.slug);

    expect(shown('all')).toHaveLength(4);
    expect(shown('security')).toEqual(['2026-10-26-b']);
    expect(shown('features')).toEqual(['2026-10-26-a']);
    expect(shown('fixes')).toEqual(['2026-10-25-a']);
    expect(shown('releases')).toEqual(['2026-10-26-vulcan-batch-overview']);
    expect(FILTERS.map((tab) => tab.id)).toEqual([
      'all',
      'releases',
      'features',
      'fixes',
      'security',
      'breaking',
    ]);
  });

  test('a date is written without the reader time zone', () => {
    expect(formatDate('2026-10-05')).toBe('October 5, 2026');
  });
});

describe('changelogFeed', () => {
  test('is RSS 2.0 with one item per entry, escaped, linked and dated', () => {
    const parsed = entry({
      slug: '2026-10-26-x',
      frontmatter: { title: 'A & B <c>' },
      src: '<Badge text="Security" />',
    });
    const xml = changelogFeed({
      site: { title: 'T', description: 'D', siteUrl: 'https://example.test/' },
      entries: parsed === null ? [] : [parsed],
    });

    expect(xml).toContain('<rss version="2.0">');
    expect(xml).toContain('<title>A &amp; B &lt;c&gt;</title>');
    expect(xml).toContain('<link>https://example.test/changelogs/2026-10-26-x</link>');
    expect(xml).toContain('<pubDate>Mon, 26 Oct 2026 12:00:00 GMT</pubDate>');
    expect(xml).toContain('<category>Security</category>');
  });
});

describe('the version folders on the changelog index (A6, C15)', () => {
  const version = (opts: { url?: string; released?: unknown; src?: string; packages?: string[] }) =>
    parseVersion({
      url: opts.url ?? '/changelogs/0.4.8/log',
      frontmatter: {
        title: '0.4.8',
        packages: opts.packages ?? ['@x/core'],
        ...(opts.released === undefined ? {} : { released: opts.released }),
      },
      src: opts.src ?? '---\ntitle: 0.4.8\n---\nThe line.\n\n## Added\n- **A** `a`: a.\n',
    });

  test('a version folder is read from its frontmatter and its first paragraph, whichever url the loader names it by', () => {
    for (const url of ['/changelogs/0.4.8/log', '/changelogs/0.4.8', '/changelogs/0.4.8.html']) {
      expect(version({ url, released: '2026-11-20' })).toMatchObject({
        url: '/changelogs/0.4.8',
        version: '0.4.8',
        title: '0.4.8',
        released: '2026-11-20',
        summary: 'The line.',
        packages: ['@x/core'],
      });
    }
  });

  test('an unquoted released: date, which the frontmatter parser reads as a Date, is the same day', () => {
    expect(version({ released: new Date('2026-11-20T00:00:00Z') })?.released).toBe('2026-11-20');
  });

  test('no released: is a line in progress; one that is not a date is neither, and the page is not an entry', () => {
    expect(version({})?.released).toBeNull();
    expect(version({ released: 'soon' })).toBeNull();
    expect(releasedOf(undefined)).toBeUndefined();
    expect(releasedOf('soon')).toBeNull();
  });

  test('released: arrives as a Date, an ISO string from the page data, or a plain day: all the same day', () => {
    expect(releasedOf(new Date('2026-11-20T00:00:00Z'))).toBe('2026-11-20');
    expect(releasedOf('2026-11-20T00:00:00.000Z')).toBe('2026-11-20');
    expect(releasedOf('2026-11-20')).toBe('2026-11-20');
    expect(releasedOf('20 Nov')).toBeNull();
  });

  test('the summary is plain text, and a file with CRLF line ends reads the same', () => {
    const crlf = version({
      src: '---\r\ntitle: x\r\n---\r\nThe **line** has `code` and a [link](https://x.test).\r\n\r\n## Added\r\n- **A** `a`: a.\r\n',
    });

    expect(crlf?.summary).toBe('The line has code and a link.');
    expect(plainText('A <b>tag</b> and _emphasis_ and **bold**')).toBe(
      'A tag and emphasis and bold',
    );
  });

  test('the sections of a page on the index are h3 with no id or permalink, so two pages share no id', () => {
    const html =
      '<h2 id="added" tabindex="-1">Added <a class="header-anchor" href="#added" aria-label="Permalink to “Added”">&#8203;</a></h2><ul><li>x</li></ul>';

    expect(demoteHeadings(html)).toBe('<h3>Added</h3><ul><li>x</li></ul>');
  });

  test('sortVersions orders by number, and the index shows the latest release, the line in progress, then the older ones', () => {
    const entries = ['0.4.10', '0.4.6', '0.4.9', '0.4.8'].flatMap((name) => {
      const entry = version({
        url: `/changelogs/${name}/log`,
        released: name === '0.4.10' ? undefined : '2026-11-01',
      });

      return entry === null ? [] : [entry];
    });
    const shown = shownVersions(entries);

    expect(sortVersions(entries).map((entry) => entry.version)).toEqual([
      '0.4.10',
      '0.4.9',
      '0.4.8',
      '0.4.6',
    ]);
    expect(shown.latest?.version).toBe('0.4.9');
    expect(shown.inProgress?.version).toBe('0.4.10');
    expect(shown.older.map((entry) => entry.version)).toEqual(['0.4.8', '0.4.6']);
  });

  test('the feed is one list by date: a released version and the dated entries are merged, a version first on its own day', () => {
    const dated = (slug: string) =>
      parseEntry({
        url: `/changelogs/${slug}`,
        frontmatter: { title: slug, description: 'D.', packages: [] },
        src: '',
      });
    const released = version({ url: '/changelogs/0.4.7/log', released: '2026-11-10' });
    const open = version({ url: '/changelogs/0.4.8/log' });
    const entries = ['2026-11-12-newer', '2026-11-10-same-day', '2026-11-01-older'].flatMap(
      (slug) => {
        const entry = dated(slug);

        return entry === null ? [] : [entry];
      },
    );
    const feed = changelogFeed({
      site: { title: 'T', description: 'D', siteUrl: 'https://x.test' },
      entries,
      versions: [released, open].flatMap((entry) => (entry === null ? [] : [entry])),
    });
    const order = [
      '2026-11-12-newer',
      'changelogs/0.4.7<',
      '2026-11-10-same-day',
      '2026-11-01-older',
    ].map((needle) => feed.indexOf(needle));

    expect(order.every((index) => index > 0)).toBe(true);
    expect(order).toEqual([...order].sort((left, right) => left - right));
    expect(feed).toContain('Tue, 10 Nov 2026 12:00:00 GMT');
    expect(feed).not.toContain('changelogs/0.4.8');
  });
});
