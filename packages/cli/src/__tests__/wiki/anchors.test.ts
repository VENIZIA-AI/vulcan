import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { AnchorProblems, checkAnchors } from '../../wiki/index.ts';

const roots: string[] = [];

const write = (opts: { root: string; path: string; text: string }): void => {
  const full = join(opts.root, opts.path);

  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, opts.text);
};

/**
 * Two trees shaped like the real ones: `content/` holds the markdown, `dist/` the html with the ids VitePress
 * would emit. The html is written by hand because the gate reads emitted ids, never a computed slug.
 */
const fixture = (): { content: string; dist: string } => {
  const root = mkdtempSync(join(tmpdir(), 'vulcan-wiki-anchors-'));

  roots.push(root);

  const content = join(root, 'content');
  const dist = join(root, 'dist');

  // `Construction - Sentinel` is the case a GitHub slugifier gets wrong: it expects `construction---sentinel`.
  write({
    root: dist,
    path: 'guides/setup.html',
    text: '<h2 id="construction-sentinel">x</h2><h2 id="step-2-install">y</h2>',
  });
  write({ root: dist, path: 'guides/index.html', text: '<h2 id="overview">z</h2>' });
  write({ root: dist, path: 'reference.html', text: '<h2 id="api">a</h2>' });
  write({
    root: content,
    path: 'guides/setup.md',
    text: [
      '# Setup',
      '',
      'Same page: [Sentinel](#construction-sentinel)',
      'Same page dead: [Gone](#no-such-heading)',
      'Relative: [Overview](./index.md#overview)',
      'Absolute: [Api](/reference#api)',
      'External: [Spec](https://example.com/page#frag)',
      '',
      '```markdown',
      'Fenced: [Fake](#not-a-real-anchor)',
      '```',
      '',
    ].join('\n'),
  });
  write({
    root: content,
    path: 'guides/index.md',
    text: [
      '# Guides',
      '',
      'Up one: [Api](../reference.md#api)',
      'Missing page: [X](/nope#api)',
      '',
    ].join('\n'),
  });

  return { content, dist };
};

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('checkAnchors', () => {
  const { checked, broken } = checkAnchors(fixture());
  const targets = broken.map((entry) => entry.target);

  test('counts every resolvable link and skips external and fenced ones', () => {
    expect(checked).toBe(6);
  });

  test('accepts an id VitePress emits but a GitHub slugifier would not', () => {
    expect(targets).not.toContain('#construction-sentinel');
  });

  test('reports a dead fragment on an existing page, with its line', () => {
    const dead = broken.find((entry) => entry.target === '#no-such-heading');

    expect(dead?.reason).toBe(AnchorProblems.DEAD_ANCHOR);
    expect(dead?.line).toBe(4);
  });

  test('reports a link to a page that does not exist', () => {
    expect(broken.find((entry) => entry.target === '/nope#api')?.reason).toBe(
      AnchorProblems.MISSING_PAGE,
    );
  });

  test('resolves relative, parent-relative and absolute targets', () => {
    expect(targets).not.toContain('./index.md#overview');
    expect(targets).not.toContain('../reference.md#api');
    expect(targets).not.toContain('/reference#api');
  });

  test('finds exactly the two planted defects', () => {
    expect(broken).toHaveLength(2);
  });
});
