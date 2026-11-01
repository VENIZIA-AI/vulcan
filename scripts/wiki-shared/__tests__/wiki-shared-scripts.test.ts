import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SharedCopy } from '../copy.ts';
import { WikiBuild } from '../build.ts';
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

describe('WikiBuild', () => {
  const home =
    '<footer class="vh site-footer"><canvas class="dust"></canvas></footer><canvas class="dust"></canvas>';

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
    const problems = WikiBuild.scanLog({ log });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(name);
  });

  test('a clean build log has no problem', () => {
    expect(
      WikiBuild.scanLog({ log: '- building client + server bundles...\nbuild complete in 5s.' }),
    ).toEqual([]);
  });

  test('the home page needs its footer and two canvases', () => {
    expect(WikiBuild.scanHome({ html: home })).toEqual([]);
    expect(WikiBuild.scanHome({ html: '<div class="vh"></div>' })).toHaveLength(2);
    expect(
      WikiBuild.scanHome({ html: '<footer class="vh site-footer"></footer><canvas></canvas>' }),
    ).toHaveLength(1);
    expect(WikiBuild.scanHome({ html: '<footer class="vh site-footer"></footer>' })).toHaveLength(
      1,
    );
    expect(WikiBuild.scanHome({ html: '<canvas></canvas><canvas></canvas>' })).toHaveLength(1);
  });

  test('an inner page must have no footer', () => {
    expect(WikiBuild.scanInner({ html: '<main></main>', page: 'references/index.html' })).toEqual(
      [],
    );
    expect(WikiBuild.scanInner({ html: home, page: 'references/index.html' })).toHaveLength(1);
  });

  test('a built site is checked as a whole', () => {
    const dist = mkdtempSync(join(tmpdir(), 'wiki-dist-'));

    roots.push(dist);
    mkdirSync(join(dist, 'references'), { recursive: true });
    writeFileSync(join(dist, 'index.html'), home);
    writeFileSync(join(dist, 'references', 'index.html'), '<main></main>');
    expect(WikiBuild.check({ dist, log: '' })).toEqual([]);
    writeFileSync(join(dist, 'index.html'), '<div class="vh"></div>');
    // one problem from the log, two from the home page
    expect(WikiBuild.check({ dist, log: 'ReferenceError: x' })).toHaveLength(3);
    expect(WikiBuild.check({ dist: join(dist, 'missing'), log: '' })).toHaveLength(1);

    // a site with no inner page to look at is not sound either: it must not be skipped silently
    rmSync(join(dist, 'references'), { recursive: true });
    writeFileSync(join(dist, 'index.html'), home);
    expect(WikiBuild.check({ dist, log: '' })).toHaveLength(1);
  });
});
