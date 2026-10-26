import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyCopy, planCopy } from '../copy.ts';
import { compare } from '../check.ts';
import {
  buildManifest,
  fingerprintOf,
  MANIFEST_FILE,
  parseManifest,
  readManifest,
  renderManifest,
  SHARED_DIR,
} from '../manifest.ts';

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
      renderManifest({ manifest: buildManifest({ root }) }),
    );
  }

  return root;
};

describe('the manifest', () => {
  test('lists every file with its hash, and the manifest itself is left out', () => {
    const root = createWiki({ files: { 'a.css': 'a', 'fonts/b.woff2': 'b' } });
    const manifest = buildManifest({ root });

    expect(Object.keys(manifest.files)).toEqual(['a.css', 'fonts/b.woff2']);
    expect(manifest.fingerprint).toBe(fingerprintOf({ files: manifest.files }));
    expect(readManifest({ root })).toEqual(manifest);
  });

  test('one changed byte changes the fingerprint', () => {
    const one = buildManifest({ root: createWiki({ files: { 'a.css': 'a' } }) });
    const two = buildManifest({ root: createWiki({ files: { 'a.css': 'b' } }) });

    expect(one.fingerprint).not.toBe(two.fingerprint);
  });

  test('untrusted JSON that is not a manifest is refused', () => {
    const hash = 'a'.repeat(64);

    expect(parseManifest({ text: 'not json' })).toBeNull();
    expect(parseManifest({ text: '{}' })).toBeNull();
    expect(parseManifest({ text: JSON.stringify({ fingerprint: 'x', files: {} }) })).toBeNull();
    expect(
      parseManifest({ text: JSON.stringify({ fingerprint: hash, files: { '../x': hash } }) }),
    ).toBeNull();
    expect(
      parseManifest({ text: JSON.stringify({ fingerprint: hash, files: { '/x': hash } }) }),
    ).toBeNull();
    expect(
      parseManifest({ text: JSON.stringify({ fingerprint: hash, files: { 'x.css': 'zz' } }) }),
    ).toBeNull();
    expect(
      parseManifest({ text: JSON.stringify({ fingerprint: hash, files: { 'x.css': hash } }) }),
    ).not.toBeNull();
  });
});

describe('copy', () => {
  test('copies new files, replaces changed ones, removes extra ones and leaves an identical manifest', () => {
    const source = createWiki({ files: { 'a.css': 'a', 'b.css': 'new' } });
    const target = createWiki({ files: { 'b.css': 'old', 'gone.css': 'x' } });

    expect(planCopy({ source, target }).map((action) => `${action.kind} ${action.path}`)).toEqual([
      'new a.css',
      'changed b.css',
      'removed gone.css',
    ]);

    applyCopy({ source, target });

    expect(readFileSync(join(target, SHARED_DIR, 'b.css'), 'utf8')).toBe('new');
    expect(buildManifest({ root: target })).toEqual(buildManifest({ root: source }));
    expect(readFileSync(join(target, SHARED_DIR, MANIFEST_FILE), 'utf8')).toBe(
      readFileSync(join(source, SHARED_DIR, MANIFEST_FILE), 'utf8'),
    );
    expect(planCopy({ source, target })).toEqual([]);
  });

  test('a dry run writes nothing', () => {
    const source = createWiki({ files: { 'a.css': 'a' } });
    const target = createWiki({ files: {} });

    planCopy({ source, target });

    expect(buildManifest({ root: target }).files).toEqual({});
  });
});

describe('compare', () => {
  const canonical = buildManifest({ root: createWiki({ files: { 'a.css': 'a', 'b.css': 'b' } }) });

  test('a copy that is identical is in step', () => {
    expect(compare({ name: 'x', canonical, theirs: canonical }).state).toBe('in-step');
  });

  test('a copy with a changed, a missing and an extra file is drifted and names them', () => {
    const theirs = buildManifest({
      root: createWiki({ files: { 'a.css': 'changed', 'c.css': 'c' } }),
    });
    const verdict = compare({ name: 'x', canonical, theirs });

    expect(verdict.state).toBe('drifted');
    expect(verdict.detail).toBe('changed a.css; missing b.css; extra c.css');
  });

  test('a wiki without a shared folder is missing', () => {
    expect(compare({ name: 'x', canonical, theirs: null }).state).toBe('missing');
  });
});
