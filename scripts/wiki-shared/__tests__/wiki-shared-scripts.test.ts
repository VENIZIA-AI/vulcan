import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SharedCopy } from '../copy.ts';
import { BuildCheck } from '../../../docs/wiki/site/.vitepress/theme/shared/build-check.ts';
import { SearchIndex } from '../../../docs/wiki/site/.vitepress/theme/shared/search-index.ts';
import { WikiSearch } from '../../../docs/wiki/site/.vitepress/theme/shared/search.ts';
import { SharedCheck } from '../check.ts';
import { MANIFEST_FILE, SHARED_DIR, SharedManifest } from '../manifest.ts';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** A checkout with a wiki and a shared folder holding `files`; its manifest is written when asked. */
const createWiki = (opts: { files: Record<string, string>; manifest?: boolean }): string => {
  const root = mkdtempSync(join(tmpdir(), 'wiki-shared-'));

  roots.push(root);
  mkdirSync(join(root, 'docs', 'wiki', 'site', '.vitepress'), { recursive: true });
  mkdirSync(join(root, SHARED_DIR), { recursive: true });

  for (const [path, content] of Object.entries(opts.files)) {
    mkdirSync(join(root, SHARED_DIR, path, '..'), { recursive: true });
    writeFileSync(join(root, SHARED_DIR, path), content);
  }

  if (opts.manifest !== false) {
    writeFileSync(
      join(root, SHARED_DIR, MANIFEST_FILE),
      SharedManifest.render({ manifest: SharedManifest.build({ root }) }),
    );
  }

  return root;
};

/** A built site holding `files`, by their paths from its root. */
const createDist = (opts: { files: Record<string, string> }): string => {
  const dist = mkdtempSync(join(tmpdir(), 'wiki-search-'));

  roots.push(dist);

  for (const [path, content] of Object.entries(opts.files)) {
    mkdirSync(join(dist, path, '..'), { recursive: true });
    writeFileSync(join(dist, path), content);
  }

  return dist;
};

describe('the manifest', () => {
  test('lists every file with its hash, and the manifest itself is left out', () => {
    const root = createWiki({ files: { 'a.css': 'a', 'fonts/b.woff2': 'b' } });
    const manifest = SharedManifest.build({ root });

    expect(Object.keys(manifest.files)).toEqual(['a.css', 'fonts/b.woff2']);
    expect(manifest.fingerprint).toBe(SharedManifest.fingerprintOf({ files: manifest.files }));
    expect(SharedManifest.read({ root })).toEqual(manifest);
  });

  test('one changed byte changes the fingerprint', () => {
    const one = SharedManifest.build({ root: createWiki({ files: { 'a.css': 'a' } }) });
    const two = SharedManifest.build({ root: createWiki({ files: { 'a.css': 'b' } }) });

    expect(one.fingerprint).not.toBe(two.fingerprint);
  });

  test('untrusted JSON that is not a manifest is refused', () => {
    const hash = 'a'.repeat(64);

    expect(SharedManifest.parse({ text: 'not json' })).toBeNull();
    expect(SharedManifest.parse({ text: '{}' })).toBeNull();
    expect(
      SharedManifest.parse({ text: JSON.stringify({ fingerprint: 'x', files: {} }) }),
    ).toBeNull();
    expect(
      SharedManifest.parse({
        text: JSON.stringify({ fingerprint: hash, files: { '../x': hash } }),
      }),
    ).toBeNull();
    expect(
      SharedManifest.parse({
        text: JSON.stringify({ fingerprint: hash, files: { '/x': hash } }),
      }),
    ).toBeNull();
    expect(
      SharedManifest.parse({
        text: JSON.stringify({ fingerprint: hash, files: { 'x.css': 'zz' } }),
      }),
    ).toBeNull();
    expect(
      SharedManifest.parse({
        text: JSON.stringify({ fingerprint: hash, files: { 'x.css': hash } }),
      }),
    ).not.toBeNull();
  });
});

describe('copy', () => {
  test('copies new files, replaces changed ones, removes extra ones and leaves an identical manifest', () => {
    const source = createWiki({ files: { 'a.css': 'a', 'b.css': 'new' } });
    const target = createWiki({ files: { 'b.css': 'old', 'gone.css': 'x' } });

    expect(
      SharedCopy.plan({ source, target }).map((action) => `${action.kind} ${action.path}`),
    ).toEqual(['new a.css', 'changed b.css', 'removed gone.css']);

    SharedCopy.apply({ source, target });

    expect(readFileSync(join(target, SHARED_DIR, 'b.css'), 'utf8')).toBe('new');
    expect(SharedManifest.build({ root: target })).toEqual(SharedManifest.build({ root: source }));
    expect(readFileSync(join(target, SHARED_DIR, MANIFEST_FILE), 'utf8')).toBe(
      readFileSync(join(source, SHARED_DIR, MANIFEST_FILE), 'utf8'),
    );
    expect(SharedCopy.plan({ source, target })).toEqual([]);
  });

  test('a dry run writes nothing', () => {
    const source = createWiki({ files: { 'a.css': 'a' } });
    const target = createWiki({ files: {} });

    SharedCopy.plan({ source, target });

    expect(SharedManifest.build({ root: target }).files).toEqual({});
  });
});

describe('SharedCheck.compare', () => {
  const canonical = SharedManifest.build({
    root: createWiki({ files: { 'a.css': 'a', 'b.css': 'b' } }),
  });

  test('a copy that is identical is in step', () => {
    expect(SharedCheck.compare({ name: 'x', canonical, theirs: canonical }).state).toBe('in-step');
  });

  test('a copy with a changed, a missing and an extra file is drifted and names them', () => {
    const theirs = SharedManifest.build({
      root: createWiki({ files: { 'a.css': 'changed', 'c.css': 'c' } }),
    });
    const verdict = SharedCheck.compare({ name: 'x', canonical, theirs });

    expect(verdict.state).toBe('drifted');
    expect(verdict.detail).toBe('changed a.css; missing b.css; extra c.css');
  });

  test('a wiki without a shared folder is missing', () => {
    const verdict = SharedCheck.compare({ name: 'x', canonical, theirs: null });

    expect(verdict.state).toBe('missing');
    expect(verdict.detail).toBe('no shared folder yet');
  });

  test('a 404 is still no shared folder yet', () => {
    const failure = { status: 404, url: 'https://example.test/SHARED.json' };
    const verdict = SharedCheck.compare({ name: 'x', canonical, theirs: null, failure });

    expect(verdict.state).toBe('missing');
    expect(verdict.detail).toBe('no shared folder yet');
  });

  test('another status is named in the detail, and the verdict still fails the check', () => {
    const failure = { status: 429, url: 'https://example.test/SHARED.json' };
    const verdict = SharedCheck.compare({ name: 'x', canonical, theirs: null, failure });

    expect(verdict.state).toBe('missing');
    expect(verdict.detail).toBe('HTTP 429 from https://example.test/SHARED.json');
  });
});

describe('BuildCheck.scanVersionPages', () => {
  const site = (opts: { served: string[] }) => {
    const root = mkdtempSync(join(tmpdir(), 'wiki-versions-'));

    roots.push(root);
    mkdirSync(join(root, 'content', 'changelogs', '0.4.7'), { recursive: true });
    mkdirSync(join(root, 'content', 'changelogs', 'drafts'), { recursive: true });
    writeFileSync(
      join(root, 'content', 'changelogs', '0.4.7', 'log.md'),
      '---\ntitle: 0.4.7\n---\n',
    );
    mkdirSync(join(root, 'dist', 'changelogs'), { recursive: true });

    for (const name of opts.served) {
      writeFileSync(join(root, 'dist', 'changelogs', name), '<div class="cx-detail"></div>');
    }

    return { changelogs: join(root, 'content', 'changelogs'), dist: join(root, 'dist') };
  };

  test('a wiki that serves its version folders passes', () => {
    expect(BuildCheck.scanVersionPages(site({ served: ['0.4.7.html'] }))).toEqual([]);
  });

  test('a wiki with no rewrite for them is told the line to add, naming the folder', () => {
    const problems = BuildCheck.scanVersionPages(site({ served: [] }));

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('changelogs/0.4.7');
    expect(problems[0]).toContain(
      "rewrites: { 'changelogs/:version/log.md': 'changelogs/:version.md' }",
    );
  });

  test('a page that built without the details component is told the config hook to add', () => {
    const built = site({ served: [] });

    writeFileSync(join(built.dist, 'changelogs', '0.4.7.html'), '<div class="vp-doc"></div>');

    const problems = BuildCheck.scanVersionPages(built);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('changelogPageData');
  });

  test('a wiki with no version folder is not asked for anything', () => {
    expect(BuildCheck.scanVersionPages({ changelogs: '/nowhere', dist: '/nowhere' })).toEqual([]);
  });
});

describe('BuildCheck.scanUpgradePages', () => {
  const site = (opts: { upgrade: string | null; yaml?: string }) => {
    const root = mkdtempSync(join(tmpdir(), 'wiki-upgrade-'));

    roots.push(root);
    mkdirSync(join(root, 'content', 'changelogs', '0.4.7'), { recursive: true });
    mkdirSync(join(root, 'content', 'changelogs', '0.4.6'), { recursive: true });
    writeFileSync(
      join(root, 'content', 'changelogs', '0.4.7', 'migration.yaml'),
      opts.yaml ?? 'a:\n  symbols: [A]\n  upgrade: { steps: [x] }\n  downgrade: { steps: [y] }\n',
    );
    writeFileSync(join(root, 'content', 'changelogs', '0.4.6', 'migration.yaml'), '{}');
    mkdirSync(join(root, 'dist', 'changelogs', '0.4.7'), { recursive: true });

    if (opts.upgrade !== null) {
      writeFileSync(join(root, 'dist', 'changelogs', '0.4.7', 'upgrade.html'), opts.upgrade);
    }

    return { changelogs: join(root, 'content', 'changelogs'), dist: join(root, 'dist') };
  };

  test('a folder with a block and a rendered upgrade page passes, and a folder with none needs no page', () => {
    expect(BuildCheck.scanUpgradePages(site({ upgrade: '<div class="cx-detail"></div>' }))).toEqual(
      [],
    );
  });

  test('a folder with a block and no upgrade page is told the route and the rewrite to add', () => {
    const problems = BuildCheck.scanUpgradePages(site({ upgrade: null }));

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('changelogs/0.4.7');
    expect(problems[0]).toContain('[version].paths.ts');
    expect(problems[0]).toContain(
      "'changelogs/upgrade/:version.md': 'changelogs/:version/upgrade.md'",
    );
  });

  test('an upgrade page that built empty is told the config hook to add', () => {
    const problems = BuildCheck.scanUpgradePages(site({ upgrade: '<div class="vp-doc"></div>' }));

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('changelogPageData');
  });

  test('a wiki with no version folder is not asked for anything', () => {
    expect(BuildCheck.scanUpgradePages({ changelogs: '/nowhere', dist: '/nowhere' })).toEqual([]);
  });
});

describe('BuildCheck.scanChangelogIndex', () => {
  const dist = (html: string | null) => {
    const root = mkdtempSync(join(tmpdir(), 'wiki-index-'));

    roots.push(root);
    mkdirSync(join(root, 'dist', 'changelogs'), { recursive: true });

    if (html !== null) {
      writeFileSync(join(root, 'dist', 'changelogs', 'index.html'), html);
    }

    return { dist: join(root, 'dist') };
  };

  test('an index that rendered the component passes', () => {
    expect(BuildCheck.scanChangelogIndex(dist('<div class="cl"><h1>Changelog</h1></div>'))).toEqual(
      [],
    );
  });

  test('an index that built empty is told to mount the component with a local import', () => {
    const problems = BuildCheck.scanChangelogIndex(dist('<div class="vp-doc"></div>'));

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(
      'mount ChangelogIndex with a local import in changelogs/index.md',
    );
  });

  test('a wiki with no built index is not asked for anything', () => {
    expect(BuildCheck.scanChangelogIndex(dist(null))).toEqual([]);
  });
});

describe('BuildCheck.scanThemeChunk', () => {
  const site = (opts: { theme: string }) => {
    const root = mkdtempSync(join(tmpdir(), 'wiki-theme-'));

    roots.push(root);
    mkdirSync(join(root, 'content', 'changelogs', '0.4.7'), { recursive: true });
    writeFileSync(
      join(root, 'content', 'changelogs', '0.4.7', 'log.md'),
      '---\ntitle: 0.4.7\n---\nA line.\n\n## Breaking\n- **X** `item-x`: x.\n\n## Fixed\n- **Y** `item-y`: y.\n',
    );
    mkdirSync(join(root, 'dist', 'assets', 'chunks'), { recursive: true });
    writeFileSync(join(root, 'dist', 'assets', 'chunks', 'theme.AbC123.js'), opts.theme);
    writeFileSync(join(root, 'dist', 'assets', 'chunks', 'other.js'), '"item-x"');

    return { changelogs: join(root, 'content', 'changelogs'), dist: join(root, 'dist') };
  };

  test('a theme chunk with an item of a version page is told to mount the pages as async components, once per version', () => {
    const problems = BuildCheck.scanThemeChunk(
      site({ theme: 'const v=[{id:"item-x"},{id:"item-y"}]' }),
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('changelogs/0.4.7');
    expect(problems[0]).toContain('async components');
  });

  test('a theme chunk with no page text passes, and a chunk that is not the theme is not read', () => {
    expect(BuildCheck.scanThemeChunk(site({ theme: 'const v=["0.4.7"]' }))).toEqual([]);
  });

  test('a wiki with no version folder or no build is not asked for anything', () => {
    expect(BuildCheck.scanThemeChunk({ changelogs: '/nowhere', dist: '/nowhere' })).toEqual([]);
  });
});

describe('BuildCheck', () => {
  const bar = '<div class="site-brand"></div><a class="venizia-link"></a>';
  const home = `${bar}<section class="vh hero"><canvas class="dust"></canvas><a class="btn btn--primary" href="/a"></a><a class="btn btn--ghost" href="/b"></a></section><footer class="vh site-footer"><canvas class="dust"></canvas><a class="btn" href="/c"></a></footer>`;
  // as the build minifies it: the mask is in the ::after of the button, the arrow is also used elsewhere
  const css =
    '--arrow-ne:url("data:image/svg+xml,x");.vh .btn{position:relative;height:40px}.vh .btn:after{-webkit-mask:var(--arrow-ne) center/100% 100% no-repeat;mask:var(--arrow-ne)}.venizia-link .arrow{mask:var(--arrow-ne)}html body{min-width:0}@media (max-width: 399px){.site-brand .brand-rule,.site-brand .brand-name{display:none}}';

  // one line per pattern, so each pattern must be the one that catches its line
  test.each([
    ['a ReferenceError', 'ReferenceError: matchMedia is not defined'],
    ['a TypeError or SyntaxError', 'TypeError: x.map is not a function'],
    ['a TypeError or SyntaxError', 'SyntaxError: Unexpected token'],
    ['"is not defined"', 'window is not defined'],
    ['a Vue warning', '[Vue warn]: Unhandled error during execution of setup function'],
    ['a hydration message', 'Hydration completed but contains mismatches'],
  ])('a build log line with %s is a problem', (name, line) => {
    const log = ['- rendering pages...', line, 'build complete in 5s.'].join('\n');
    const problems = BuildCheck.scanLog({ log });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(name);
  });

  test('a clean build log has no problem', () => {
    expect(
      BuildCheck.scanLog({ log: '- building client + server bundles...\nbuild complete in 5s.' }),
    ).toEqual([]);
  });

  test('the home page needs its hero with two buttons, the footer, two canvases and the top bar', () => {
    expect(BuildCheck.scanHome({ html: home })).toEqual([]);
    // each part missing alone is one problem
    expect(BuildCheck.scanHome({ html: home.replace('vh hero', 'vh main') })).toHaveLength(1);
    expect(BuildCheck.scanHome({ html: home.replace('site-footer', 'x') })).toHaveLength(1);
    expect(
      BuildCheck.scanHome({ html: home.replace('<canvas class="dust"></canvas>', '') }),
    ).toHaveLength(1);
    expect(BuildCheck.scanHome({ html: home.replace('site-brand', 'x') })).toHaveLength(1);
    expect(BuildCheck.scanHome({ html: home.replace('venizia-link', 'x') })).toHaveLength(1);
    expect(BuildCheck.scanHome({ html: '<div class="vh"></div>' })).toHaveLength(5);
  });

  test("the buttons are counted in the hero: the footer's do not make up for a hero without them", () => {
    expect(BuildCheck.scanHome({ html: home.replace(' class="btn btn--ghost"', '') })).toHaveLength(
      1,
    );
    expect(
      BuildCheck.scanHome({
        html: home.replace(/<a class="btn btn--(primary|ghost)"[^>]*><\/a>/g, ''),
      }),
    ).toHaveLength(1);
  });

  test.each([
    'class="eco"',
    'class="eco-btn"',
    'class="vh eco open"',
    'class="eco-logo--word"',
    'class="x eco-btn-icon y"',
  ])('the ecosystem switcher (%s) must not come back', (attribute) => {
    expect(BuildCheck.scanHome({ html: `${home}<div ${attribute}></div>` })).toHaveLength(1);
  });

  test('a class that only starts like eco is not the switcher', () => {
    expect(BuildCheck.scanHome({ html: `${home}<div class="economy"></div>` })).toEqual([]);
  });

  test('the search is the Pagefind index, and the local search of VitePress is gone', () => {
    const dist = createDist({ files: { 'pagefind/pagefind.js': '' } });

    expect(BuildCheck.scanSearch({ dist })).toEqual([]);

    const [missing] = BuildCheck.scanSearch({ dist: createDist({ files: {} }) });

    expect(missing).toContain('search-index.ts');

    const [local] = BuildCheck.scanSearch({
      dist: createDist({
        files: { 'pagefind/pagefind.js': '', 'assets/chunks/@localSearchIndexroot.a1.js': '' },
      }),
    });

    expect(local).toContain("provider: 'local'");
  });

  test('an inner page has the top bar and no footer', () => {
    expect(BuildCheck.scanInner({ html: bar, page: 'references/index.html' })).toEqual([]);
    expect(BuildCheck.scanInner({ html: home, page: 'references/index.html' })).toHaveLength(1);
    expect(
      BuildCheck.scanInner({ html: '<main></main>', page: 'references/index.html' }),
    ).toHaveLength(2);
  });

  test('the style sheets must hold the button arrow, the 40 px button and no static dot pattern', () => {
    expect(BuildCheck.scanStyles({ css })).toEqual([]);
    expect(BuildCheck.scanStyles({ css: css.replace('--arrow-ne:url(', '--x:url(') })).toHaveLength(
      1,
    );
    // the variable is used, but not by the button's ::after
    expect(
      BuildCheck.scanStyles({ css: css.replace('.vh .btn:after{', '.vh .nope:after{') }),
    ).toHaveLength(1);
    expect(
      BuildCheck.scanStyles({ css: css.replace('.vh .btn:after{', '.vh .btn::after{') }),
    ).toEqual([]);
    expect(BuildCheck.scanStyles({ css: css.replace('height:40px', 'height:48px') })).toHaveLength(
      1,
    );
    // min-height and line-height are not the height of the button
    expect(
      BuildCheck.scanStyles({
        css: css.replace('height:40px', 'min-height:40px;line-height:40px'),
      }),
    ).toHaveLength(1);
    expect(
      BuildCheck.scanStyles({
        css: `${css}.vh .hero:before{background-image:radial-gradient(circle at 1px 1px,#0003 1px,transparent 0)}`,
      }),
    ).toHaveLength(1);
    expect(
      BuildCheck.scanStyles({
        css: `${css}.x{background:radial-gradient(circle at 0.5px 0.5px,#fff 1px,transparent 0)}`,
      }),
    ).toHaveLength(1);
    // the body keeps the default theme's 320 px minimum, or the brand name stays at narrow widths
    expect(BuildCheck.scanStyles({ css: css.replace('html body{min-width:0}', '') })).toHaveLength(
      1,
    );
    expect(BuildCheck.scanStyles({ css: css.replace('399px', '599px') })).toHaveLength(1);
    expect(BuildCheck.scanStyles({ css: '' })).toHaveLength(5);
  });

  test('a built site is checked as a whole', () => {
    const dist = mkdtempSync(join(tmpdir(), 'wiki-dist-'));

    roots.push(dist);
    mkdirSync(join(dist, 'references'), { recursive: true });
    mkdirSync(join(dist, 'assets'), { recursive: true });
    mkdirSync(join(dist, 'pagefind'), { recursive: true });
    writeFileSync(join(dist, 'pagefind', 'pagefind.js'), '');
    writeFileSync(join(dist, 'index.html'), home);
    writeFileSync(join(dist, 'references', 'index.html'), bar);
    writeFileSync(join(dist, 'assets', 'style.css'), css);
    expect(BuildCheck.check({ dist, log: '' })).toEqual([]);
    writeFileSync(join(dist, 'index.html'), '<div class="vh"></div>');
    // one problem from the log, five from the home page
    expect(BuildCheck.check({ dist, log: 'ReferenceError: x' })).toHaveLength(6);
    expect(BuildCheck.check({ dist: join(dist, 'missing'), log: '' })).toHaveLength(1);

    // no style sheet at all is five problems, not a pass
    rmSync(join(dist, 'assets'), { recursive: true });
    writeFileSync(join(dist, 'index.html'), home);
    expect(BuildCheck.check({ dist, log: '' })).toHaveLength(5);

    // a site with no inner page to look at is not sound either: it must not be skipped silently
    rmSync(join(dist, 'references'), { recursive: true });
    expect(BuildCheck.check({ dist, log: '' })).toHaveLength(6);
  });

  test('--check --log scans the log of an earlier build; a missing log file is a failure', () => {
    const root = mkdtempSync(join(tmpdir(), 'wiki-root-'));
    const dist = join(root, 'docs', 'wiki', 'site', '.vitepress', 'dist');

    roots.push(root);
    mkdirSync(join(dist, 'references'), { recursive: true });
    mkdirSync(join(dist, 'assets'), { recursive: true });
    mkdirSync(join(dist, 'pagefind'), { recursive: true });
    writeFileSync(join(dist, 'pagefind', 'pagefind.js'), '');
    writeFileSync(join(dist, 'index.html'), home);
    writeFileSync(join(dist, 'references', 'index.html'), bar);
    writeFileSync(join(dist, 'assets', 'style.css'), css);

    const clean = join(root, 'clean.log');
    const broken = join(root, 'broken.log');

    writeFileSync(clean, 'build complete in 5s.\n');
    writeFileSync(broken, 'ReferenceError: matchMedia is not defined\n');
    expect(BuildCheck.run({ root, build: false, logFile: clean })).toBe(0);
    expect(BuildCheck.run({ root, build: false })).toBe(0);
    expect(BuildCheck.run({ root, build: false, logFile: broken })).toBe(1);
    expect(BuildCheck.run({ root, build: false, logFile: join(root, 'none.log') })).toBe(1);
  });

  test('it refuses to build from inside a docs build, so wiring it in the wrong mode cannot loop', () => {
    const before = process.env['WIKI_BUILD_CHECK'];

    process.env['WIKI_BUILD_CHECK'] = '1';

    try {
      expect(BuildCheck.run({ root: join(tmpdir(), 'nowhere'), build: true })).toBe(1);
    } finally {
      if (before === undefined) {
        delete process.env['WIKI_BUILD_CHECK'];
      } else {
        process.env['WIKI_BUILD_CHECK'] = before;
      }
    }
  });
});

describe('the search index of a wiki', () => {
  test('is built by this Bun running the installed Pagefind, over the built site', () => {
    const command = SearchIndex.commandOf({ wiki: '/srv/vulcan-fixture/docs/wiki' });

    expect(command.slice(0, 4)).toEqual([
      process.execPath,
      '/srv/vulcan-fixture/docs/wiki/node_modules/pagefind/lib/runner/bin.cjs',
      '--site',
      '/srv/vulcan-fixture/docs/wiki/site/.vitepress/dist',
    ]);
    expect(command.at(-1)).toContain('span.lang');
  });

  test('a built page marks its content for the index and keeps its table cells apart', () => {
    const page = SearchIndex.mark({
      html: '<div class="VPNav">menu</div><div class="VPContent x"><h1>Config</h1><table><tr><th>Export</th><th>Kind</th></tr><tr><td>a</td><td>b</td></tr></table></div>',
    });

    expect(page).toContain('<div class="VPContent x" data-pagefind-body="">');
    // The h1 names the page in a result row, so it is not part of the text an excerpt is cut from.
    expect(page).toContain('<h1 data-pagefind-meta="title" data-pagefind-ignore="">Config</h1>');
    expect(page).toContain('<th>Export </th><th>Kind </th>');
    expect(page).toContain('<td>a </td><td>b </td>');
    expect(page).toContain('<div class="VPNav">menu</div>');
    expect(SearchIndex.mark({ html: page })).toBe(page);

    // Only the first h1 names the page: a changelog page has a second one.
    expect(
      SearchIndex.mark({ html: '<div class="VPContent"><h1>Title</h1><h1>Changelog</h1></div>' }),
    ).toContain('<h1>Changelog</h1>');

    // A page that only writes the attribute's name in its text is still marked.
    expect(
      SearchIndex.mark({ html: '<div class="VPContent"><p>data-pagefind-body</p></div>' }),
    ).toContain('<div class="VPContent" data-pagefind-body="">');
  });

  test('a wiki without Pagefind installed fails and downloads nothing', async () => {
    expect(await SearchIndex.run({ wiki: join(tmpdir(), 'wiki-without-pagefind') })).toBe(1);
  });
});

describe('what a search lists for a page', () => {
  const page = { url: '/a.html', excerpt: 'the page', meta: { title: 'Runtime config \u{200B}' } };

  test('the page itself when no section matched', () => {
    expect(WikiSearch.hitsOf({ page })).toEqual([
      { url: '/a.html', title: 'Runtime config', excerpt: 'the page' },
    ]);
  });

  test('at most three sections, and a section named like its page is not said twice', () => {
    const section = (title: string, at: number) => ({
      url: `/a.html#${at}`,
      title,
      excerpt: `${at}`,
    });
    const hits = WikiSearch.hitsOf({
      page: {
        ...page,
        // eslint-disable-next-line @typescript-eslint/naming-convention -- Pagefind's own name
        sub_results: [
          section('Runtime config', 1),
          // Pagefind lists the page and the section of its first heading: one name, one row.
          section('Runtime config \u{200B}', 5),
          section('Options \u{200B}', 2),
          section('Errors', 3),
          section('More', 4),
        ],
      },
    });

    expect(hits.map((hit) => hit.title)).toEqual([
      'Runtime config',
      'Runtime config - Options',
      'Runtime config - Errors',
    ]);
  });
});
