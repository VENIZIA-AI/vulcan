import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

describe('the folder history of a source pinned to an older tag', () => {
  const projectWith = (opts: { folders: string[] }) => {
    const root = mkdtempSync(join(tmpdir(), 'atlas-served-folders-'));

    roots.push(root);

    for (const folder of opts.folders) {
      mkdirSync(join(root, 'changes', folder), { recursive: true });
      writeFileSync(
        join(root, 'changes', folder, 'log.md'),
        `---\ntitle: ${folder}\nversion: ${folder}\n---\n`,
      );
    }

    return ProjectConfig.toAtlasProject({
      root,
      manifest: {
        schemaVersion: 1,
        packages: [{ name: '@a/kernel', dir: 'kernel', aliases: [], retired: false }],
        knowledge: { changelogs: 'changes' },
        release: { tagPattern: '<dir>-v<version>', ignoreTags: [] },
      },
    });
  };
  const namesOf = (opts: { refProject?: ReturnType<typeof projectWith> }): string[] => {
    const project = projectWith({ folders: ['0.4.8'] });
    const store = ServedReleases.storeOf({
      source: { name: 'src', project, refProject: opts.refProject },
      table: ReleaseCompute.compute({ project }),
    });

    return (store.folderHistoryOf()?.folders() ?? []).map((folder) => folder.name);
  };

  test('reads the folders of the ref project when the corpus is pinned', () => {
    expect(namesOf({ refProject: projectWith({ folders: ['0.4.8', '0.5.0'] }) })).toEqual([
      '0.4.8',
      '0.5.0',
    ]);
  });

  test('an unpinned source reads its own folders', () => {
    expect(namesOf({})).toEqual(['0.4.8']);
  });
});
