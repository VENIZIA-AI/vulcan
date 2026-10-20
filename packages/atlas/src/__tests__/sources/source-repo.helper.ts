import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSyncBounded } from '../spawn.helper';

/** A registry that refuses at once: a test never reaches npm, and a pull's tarball step skips fast. */
export const NO_REGISTRY = 'http://127.0.0.1:9';

/** Every directory a test made; the test file removes them in `afterAll`. */
export const TEMP_DIRECTORIES: string[] = [];

export const makeTempDirectory = (opts: { prefix: string }): string => {
  const directory = mkdtempSync(join(tmpdir(), opts.prefix));

  TEMP_DIRECTORIES.push(directory);

  return directory;
};

export const git = (opts: { cwd: string; args: string[] }): string => {
  const result = spawnSyncBounded({
    cmd: ['git', '-c', 'user.name=t', '-c', 'user.email=t@t', ...opts.args],
    cwd: opts.cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (result.exitCode !== 0) {
    throw new Error(`git ${opts.args.join(' ')}: ${result.stderr.toString()}`);
  }

  return result.stdout.toString().trim();
};

/** What a source commits for atlas (Project Contract v1, C1) - data, never code. */
export const SOURCE_MANIFEST = `${JSON.stringify(
  {
    schemaVersion: 1,
    name: 'src',
    packages: [
      { name: '@x/kernel', dir: 'kernel', path: 'packages/kernel', aliases: [], retired: false },
    ],
    knowledge: { bundle: '.agents/knowledge', changelogs: 'docs/changelogs' },
    release: { tagPattern: '<dir>-v<version>', ignoreTags: [] },
  },
  null,
  2,
)}\n`;

export const writeSourceFile = (opts: { work: string; path: string; text: string }): void => {
  const file = join(opts.work, opts.path);

  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, opts.text);
};

export const commitAll = (opts: { work: string; message: string }): void => {
  git({ cwd: opts.work, args: ['add', '-A'] });
  git({ cwd: opts.work, args: ['commit', '-q', '-m', opts.message] });
};

/**
 * A source project behind a bare repository: its manifest, a knowledge bundle, a changelog, a
 * release tag, and a `packages/` tree the manifest does not declare as knowledge.
 */
export const makeSourceRepository = (): { bare: string; work: string; url: string } => {
  const bare = join(makeTempDirectory({ prefix: 'atlas-source-bare-' }), 'source.git');
  const work = makeTempDirectory({ prefix: 'atlas-source-work-' });

  mkdirSync(bare);
  git({ cwd: bare, args: ['init', '-q', '--bare', '-b', 'develop'] });
  git({ cwd: bare, args: ['config', 'uploadpack.allowFilter', 'true'] });
  git({ cwd: work, args: ['init', '-q', '-b', 'develop'] });

  writeSourceFile({ work, path: 'package.json', text: '{ "name": "@x/source-workspace" }\n' });
  writeSourceFile({ work, path: '.agents/vulcan.manifest.json', text: SOURCE_MANIFEST });
  // Code a fetched source must never run: atlas reads the manifest, not this.
  writeSourceFile({
    work,
    path: '.configs/vulcan.config.ts',
    text: 'throw new Error("never imported");\n',
  });
  writeSourceFile({
    work,
    path: '.agents/knowledge/overview/kernel.md',
    text: '---\ntype: Concept\ntitle: Kernel\ndescription: The kernel.\n---\n\nThe kernel boots the application.\n',
  });
  writeSourceFile({
    work,
    path: 'docs/changelogs/2026-01-01-first.md',
    text: "---\ntitle: First\npackages: ['@x/kernel']\n---\n\nThe first change.\n",
  });
  writeSourceFile({
    work,
    path: 'packages/kernel/src/index.ts',
    text: 'export const kernel = 1;\n',
  });
  commitAll({ work, message: 'chore: the source' });
  git({ cwd: work, args: ['tag', 'kernel-v1.0.0'] });
  git({ cwd: work, args: ['remote', 'add', 'origin', bare] });
  git({ cwd: work, args: ['push', '-q', 'origin', 'develop', '--tags'] });

  return { bare, work, url: `file://${bare}` };
};
