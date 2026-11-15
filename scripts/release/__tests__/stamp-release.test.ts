import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReleaseStamp } from '../stamp-release.ts';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const LOG = "---\ntitle: 0.4.8\nversion: 0.4.8\npackages: ['@x/cli']\n---\nThe line.\n";

const project = (opts: { log?: string; folders?: boolean }): string => {
  const root = mkdtempSync(join(tmpdir(), 'stamp-release-'));

  roots.push(root);
  mkdirSync(join(root, '.agents'), { recursive: true });
  writeFileSync(
    join(root, '.agents', 'vulcan.manifest.json'),
    JSON.stringify({
      release: { tagPattern: 'vulcan-v<version>' },
      knowledge: { changelogs: 'docs/changelogs' },
      packages: [],
    }),
  );

  if (opts.log !== undefined) {
    mkdirSync(join(root, 'docs', 'changelogs', '0.4.8'), { recursive: true });
    writeFileSync(join(root, 'docs', 'changelogs', '0.4.8', 'log.md'), opts.log);
  }

  return root;
};

describe('ReleaseStamp.stamped', () => {
  test('writes released: as the last frontmatter line and leaves the body alone', () => {
    expect(ReleaseStamp.stamped({ text: LOG, date: '2026-11-20' })).toBe(
      "---\ntitle: 0.4.8\nversion: 0.4.8\npackages: ['@x/cli']\nreleased: 2026-11-20\n---\nThe line.\n",
    );
  });

  test('a log that already says that date is left as it is; another date is refused', () => {
    const stamped = ReleaseStamp.stamped({ text: LOG, date: '2026-11-20' }) ?? '';

    expect(ReleaseStamp.stamped({ text: stamped, date: '2026-11-20' })).toBeUndefined();
    expect(() => ReleaseStamp.stamped({ text: stamped, date: '2026-11-21' })).toThrow('frozen');
  });

  test('a log with no frontmatter is refused', () => {
    expect(() => ReleaseStamp.stamped({ text: 'no frontmatter\n', date: '2026-11-20' })).toThrow(
      'no frontmatter',
    );
  });
});

describe('ReleaseStamp.main', () => {
  test('C12: stamps the folder of the version and prints its path', () => {
    const root = project({ log: LOG });

    expect(
      ReleaseStamp.main({ args: ['--version', '0.4.8', '--date', '2026-11-20'], cwd: root }),
    ).toBe(0);
    expect(readFileSync(join(root, 'docs', 'changelogs', '0.4.8', 'log.md'), 'utf8')).toContain(
      'released: 2026-11-20',
    );
  });

  test('a project with no folder for the version writes nothing and succeeds', () => {
    const root = project({});

    expect(
      ReleaseStamp.main({ args: ['--version', '0.4.8', '--date', '2026-11-20'], cwd: root }),
    ).toBe(0);
  });

  test('a malformed version or date exits 2; a frozen folder with another date exits 1', () => {
    const root = project({ log: `${LOG.replace('---\nThe', 'released: 2026-11-01\n---\nThe')}` });

    expect(
      ReleaseStamp.main({ args: ['--version', 'latest', '--date', '2026-11-20'], cwd: root }),
    ).toBe(2);
    expect(ReleaseStamp.main({ args: ['--version', '0.4.8', '--date', 'today'], cwd: root })).toBe(
      2,
    );
    expect(
      ReleaseStamp.main({ args: ['--version', '0.4.8', '--date', '2026-11-20'], cwd: root }),
    ).toBe(1);
  });
});
