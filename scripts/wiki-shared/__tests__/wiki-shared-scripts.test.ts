import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SharedCopy } from '../copy.ts';
import { BuildCheck } from '../../../docs/wiki/site/.vitepress/theme/shared/build-check.ts';
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

describe('BuildCheck', () => {
  const bar = '<div class="site-brand"></div><a class="venizia-link"></a>';
  const home = `${bar}<section class="vh hero"><canvas class="dust"></canvas><a class="btn btn--primary" href="/a"></a><a class="btn btn--ghost" href="/b"></a></section><footer class="vh site-footer"><canvas class="dust"></canvas><a class="btn" href="/c"></a></footer>`;
  // as the build minifies it: the mask is in the ::after of the button, the arrow is also used elsewhere
  const css =
    '--arrow-ne:url("data:image/svg+xml,x");.vh .btn{position:relative;height:40px}.vh .btn:after{-webkit-mask:var(--arrow-ne) center/100% 100% no-repeat;mask:var(--arrow-ne)}.venizia-link .arrow{mask:var(--arrow-ne)}';

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
    expect(BuildCheck.scanStyles({ css: '' })).toHaveLength(3);
  });

  test('a built site is checked as a whole', () => {
    const dist = mkdtempSync(join(tmpdir(), 'wiki-dist-'));

    roots.push(dist);
    mkdirSync(join(dist, 'references'), { recursive: true });
    mkdirSync(join(dist, 'assets'), { recursive: true });
    writeFileSync(join(dist, 'index.html'), home);
    writeFileSync(join(dist, 'references', 'index.html'), bar);
    writeFileSync(join(dist, 'assets', 'style.css'), css);
    expect(BuildCheck.check({ dist, log: '' })).toEqual([]);
    writeFileSync(join(dist, 'index.html'), '<div class="vh"></div>');
    // one problem from the log, five from the home page
    expect(BuildCheck.check({ dist, log: 'ReferenceError: x' })).toHaveLength(6);
    expect(BuildCheck.check({ dist: join(dist, 'missing'), log: '' })).toHaveLength(1);

    // no style sheet at all is three problems, not a pass
    rmSync(join(dist, 'assets'), { recursive: true });
    writeFileSync(join(dist, 'index.html'), home);
    expect(BuildCheck.check({ dist, log: '' })).toHaveLength(3);

    // a site with no inner page to look at is not sound either: it must not be skipped silently
    rmSync(join(dist, 'references'), { recursive: true });
    expect(BuildCheck.check({ dist, log: '' })).toHaveLength(4);
  });

  test('--check --log scans the log of an earlier build; a missing log file is a failure', () => {
    const root = mkdtempSync(join(tmpdir(), 'wiki-root-'));
    const dist = join(root, 'docs', 'wiki', 'site', '.vitepress', 'dist');

    roots.push(root);
    mkdirSync(join(dist, 'references'), { recursive: true });
    mkdirSync(join(dist, 'assets'), { recursive: true });
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
