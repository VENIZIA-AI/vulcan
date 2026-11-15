import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectConfig } from '@/common/project-config';
import { ReleaseCompute } from '@/releases';
import { ServedReleases } from '@/server/served-releases';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const storeWith = (opts: { siteUrl?: string }) => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-served-releases-'));

  roots.push(root);

  const project = ProjectConfig.toAtlasProject({
    root,
    manifest: {
      schemaVersion: 1,
      packages: [{ name: '@a/kernel', dir: 'kernel', aliases: [], retired: false }],
      knowledge: { ...(opts.siteUrl === undefined ? {} : { siteUrl: opts.siteUrl }) },
      release: { tagPattern: '<dir>-v<version>', ignoreTags: [] },
    },
  });

  return ServedReleases.storeOf({
    source: { name: 'src', project },
    table: ReleaseCompute.compute({ project }),
  });
};

describe('the release store of a served source', () => {
  test('carries what the source project says: its wiki, its packages', () => {
    const store = storeWith({ siteUrl: 'https://wiki.example.com/' });

    expect(store.siteUrlOf()).toBe('https://wiki.example.com');
    expect(store.codemodPackagesOf()).toEqual(['@a/kernel']);
    expect(storeWith({}).siteUrlOf()).toBeUndefined();
  });

  test('every store of a source is built there: the repository store, the cached store and the one a refresh makes', () => {
    const text = readFileSync(join(__dirname, '../../server/sources.ts'), 'utf8');

    expect(text).not.toContain('new ReleaseStore(');
    expect(text.match(/ServedReleases\.storeOf\(/g)).toHaveLength(3);
  });
});
