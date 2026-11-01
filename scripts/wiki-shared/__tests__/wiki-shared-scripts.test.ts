import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SharedCopy } from '../copy.ts';
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
      SharedManifest.renderManifest({ manifest: SharedManifest.buildManifest({ root }) }),
    );
  }

  return root;
};

describe('the manifest', () => {
  test('lists every file with its hash, and the manifest itself is left out', () => {
    const root = createWiki({ files: { 'a.css': 'a', 'fonts/b.woff2': 'b' } });
    const manifest = SharedManifest.buildManifest({ root });

    expect(Object.keys(manifest.files)).toEqual(['a.css', 'fonts/b.woff2']);
    expect(manifest.fingerprint).toBe(SharedManifest.fingerprintOf({ files: manifest.files }));
    expect(SharedManifest.readManifest({ root })).toEqual(manifest);
  });

  test('one changed byte changes the fingerprint', () => {
    const one = SharedManifest.buildManifest({ root: createWiki({ files: { 'a.css': 'a' } }) });
    const two = SharedManifest.buildManifest({ root: createWiki({ files: { 'a.css': 'b' } }) });

    expect(one.fingerprint).not.toBe(two.fingerprint);
  });

  test('untrusted JSON that is not a manifest is refused', () => {
    const hash = 'a'.repeat(64);

    expect(SharedManifest.parseManifest({ text: 'not json' })).toBeNull();
    expect(SharedManifest.parseManifest({ text: '{}' })).toBeNull();
    expect(
      SharedManifest.parseManifest({ text: JSON.stringify({ fingerprint: 'x', files: {} }) }),
    ).toBeNull();
    expect(
      SharedManifest.parseManifest({
        text: JSON.stringify({ fingerprint: hash, files: { '../x': hash } }),
      }),
    ).toBeNull();
    expect(
      SharedManifest.parseManifest({
        text: JSON.stringify({ fingerprint: hash, files: { '/x': hash } }),
      }),
    ).toBeNull();
    expect(
      SharedManifest.parseManifest({
        text: JSON.stringify({ fingerprint: hash, files: { 'x.css': 'zz' } }),
      }),
    ).toBeNull();
    expect(
      SharedManifest.parseManifest({
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
      SharedCopy.planCopy({ source, target }).map((action) => `${action.kind} ${action.path}`),
    ).toEqual(['new a.css', 'changed b.css', 'removed gone.css']);

    SharedCopy.applyCopy({ source, target });

    expect(readFileSync(join(target, SHARED_DIR, 'b.css'), 'utf8')).toBe('new');
    expect(SharedManifest.buildManifest({ root: target })).toEqual(
      SharedManifest.buildManifest({ root: source }),
    );
    expect(readFileSync(join(target, SHARED_DIR, MANIFEST_FILE), 'utf8')).toBe(
      readFileSync(join(source, SHARED_DIR, MANIFEST_FILE), 'utf8'),
    );
    expect(SharedCopy.planCopy({ source, target })).toEqual([]);
  });

  test('a dry run writes nothing', () => {
    const source = createWiki({ files: { 'a.css': 'a' } });
    const target = createWiki({ files: {} });

    SharedCopy.planCopy({ source, target });

    expect(SharedManifest.buildManifest({ root: target }).files).toEqual({});
  });
});

describe('SharedCheck.compare', () => {
  const canonical = SharedManifest.buildManifest({
    root: createWiki({ files: { 'a.css': 'a', 'b.css': 'b' } }),
  });

  test('a copy that is identical is in step', () => {
    expect(SharedCheck.compare({ name: 'x', canonical, theirs: canonical }).state).toBe('in-step');
  });

  test('a copy with a changed, a missing and an extra file is drifted and names them', () => {
    const theirs = SharedManifest.buildManifest({
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
