import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MigrateApply, MigratePlan } from '@/migrations';
import { ProjectConfig } from '@/common/project-config';
import { FolderHistory, ReleaseCompute, ReleaseStore } from '@/releases';
import { FolderBlobs } from '@/sources/folder-blobs';
import { GitRepository } from '@/sources/git';
import { rmSync } from 'node:fs';
import {
  commitAll,
  git,
  makeTempDirectory,
  TEMP_DIRECTORIES,
  writeSourceFile,
} from './source-repo.helper';

afterAll(() => {
  for (const directory of TEMP_DIRECTORIES) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const block = (n: number): string =>
  `  symbols: [Thing.make]\n  upgrade: { before: "Thing.make()", after: "Up${n}()" }\n  downgrade: { steps: ["Down${n}"] }\n`;

const log = (ids: string[]): string =>
  `---\ntitle: 0.4.5\nversion: 0.4.5\npackages: ['@x/kernel']\n---\n\n## Breaking\n${ids.map((id) => `- **${id}** \`${id}\`: text.\n`).join('')}`;

const MANIFEST = `${JSON.stringify({
  schemaVersion: 1,
  name: 'src',
  packages: [
    { name: '@x/kernel', dir: 'kernel', path: 'packages/kernel', aliases: [], retired: false },
  ],
  knowledge: { changelogs: 'changes' },
  release: { tagPattern: '<dir>-v<version>', ignoreTags: [] },
})}\n`;

/** A source whose line 0.4.5 changes at each prerelease tag, served as a git remote that allows partial clones and fetching a blob by id. */
const remote = () => {
  const bare = join(makeTempDirectory({ prefix: 'atlas-blobs-bare-' }), 'source.git');
  const work = makeTempDirectory({ prefix: 'atlas-blobs-work-' });

  git({ cwd: work, args: ['init', '-q', '-b', 'develop'] });
  git({ cwd: work, args: ['init', '-q', '--bare', '-b', 'develop', bare] });
  git({ cwd: bare, args: ['config', 'uploadpack.allowFilter', 'true'] });
  git({ cwd: bare, args: ['config', 'uploadpack.allowAnySHA1InWant', 'true'] });
  writeSourceFile({ work, path: '.agents/vulcan.manifest.json', text: MANIFEST });
  commitAll({ work, message: 'chore: manifest' });

  const state = (opts: { tag: string; ids: string[]; blocks: Record<string, number> }): void => {
    writeSourceFile({ work, path: 'changes/0.4.5/log.md', text: log(opts.ids) });
    writeSourceFile({
      work,
      path: 'changes/0.4.5/migration.yaml',
      text: opts.ids.map((id) => `${id}:\n${block(opts.blocks[id])}`).join(''),
    });
    commitAll({ work, message: opts.tag });
    git({ cwd: work, args: ['tag', '-a', opts.tag, '-m', opts.tag] });
  };

  state({ tag: 'kernel-v0.4.5-14', ids: ['aa'], blocks: { aa: 1 } });
  state({ tag: 'kernel-v0.4.5-15', ids: ['aa', 'bb'], blocks: { aa: 1, bb: 2 } });
  state({ tag: 'kernel-v0.4.5-16', ids: ['aa', 'bb'], blocks: { aa: 1, bb: 3 } });
  git({ cwd: work, args: ['remote', 'add', 'origin', bare] });
  git({ cwd: work, args: ['push', '-q', 'origin', 'develop', '--tags'] });

  return { url: `file://${bare}`, sha: git({ cwd: work, args: ['rev-parse', 'HEAD'] }) };
};

/** The source as atlas pulls it: a partial clone with no blobs, and a sparse checkout of `.agents` and the version folders. */
const pulled = (opts: { url: string; sha: string }) => {
  const gitDir = join(makeTempDirectory({ prefix: 'atlas-blobs-clone-' }), 'git');
  const checkout = makeTempDirectory({ prefix: 'atlas-blobs-checkout-' });

  GitRepository.updateClone({ url: opts.url, gitDir, sha: opts.sha });
  GitRepository.sparseCheckout({ gitDir, directory: checkout, sha: opts.sha, paths: ['.agents'] });

  const project = ProjectConfig.toAtlasProject({
    root: checkout,
    manifest: JSON.parse(readFileSync(join(checkout, '.agents', 'vulcan.manifest.json'), 'utf8')),
  });

  GitRepository.setSparsePaths({
    directory: checkout,
    paths: ['.agents', ...FolderBlobs.directoriesAt({ gitDir, sha: opts.sha, folder: 'changes' })],
  });

  return { gitDir, checkout, project };
};

const planOf = (opts: {
  project: ReturnType<typeof pulled>['project'];
  from: string;
  to: string;
}) =>
  MigratePlan.plans({
    releases: new ReleaseStore({
      table: ReleaseCompute.compute({ project: opts.project }),
      folderHistory: new FolderHistory({ project: opts.project }),
      codemodPackages: ['@x/kernel'],
    }),
    app: makeTempDirectory({ prefix: 'atlas-blobs-app-' }),
    package: '@x/kernel',
    from: opts.from,
    to: opts.to,
  }).plans[0];

describe('a source cloned without blobs', () => {
  test('before its blobs are fetched, the plan says it read an earlier tag, is degraded, and apply refuses it', () => {
    const source = remote();
    const { project, checkout } = pulled(source);
    const plan = planOf({ project, from: '0.4.5-15', to: '0.4.5-16' });

    expect(plan.degraded).toBe(true);
    expect(plan.note).toContain('could not be read');

    const err: string[] = [];
    const code = MigrateApply.run({
      result: { app: checkout, plans: [plan], skipped: [], unserved: [] },
      force: false,
      out: () => undefined,
      err: (text) => err.push(text),
    });

    expect(code).toBe(1);
    expect(err.join('')).toContain('the folder state could not be read exactly');
  });

  test('C11: after the pull-time prefetch the same plan is exact, and equals the one of a full clone', () => {
    const source = remote();
    const { gitDir, project } = pulled(source);
    const outcome = FolderBlobs.prefetch({ project, gitDir, url: source.url, sha: source.sha });
    const plan = planOf({ project, from: '0.4.5-15', to: '0.4.5-16' });

    expect(outcome.error).toBeUndefined();
    expect(outcome.fetched).toBeGreaterThan(0);
    expect(plan.degraded).toBeUndefined();
    expect(plan.steps.map((step) => `${step.direction}:${step.id}`)).toEqual([
      'downgrade:bb',
      'upgrade:bb',
    ]);
  });

  test('a prefetch that cannot reach the remote reports it and throws nothing', () => {
    const source = remote();
    const { gitDir, project } = pulled(source);
    const outcome = FolderBlobs.prefetch({
      project,
      gitDir,
      url: 'file:///nowhere/at/all.git',
      sha: source.sha,
    });

    expect(outcome.error).toBeDefined();
  });
});
