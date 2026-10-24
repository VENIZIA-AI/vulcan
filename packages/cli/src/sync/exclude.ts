import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { excludePathsOf, mergeExcludeBlock, renderExcludeBlock } from '../agents/index.ts';
import { BASE_DIRECTORY } from '../common/index.ts';
import { SyncConstants, SyncStatuses } from './common/index.ts';
import type { ISyncAction } from './common/index.ts';

const NO_CHANGE = (): void => {};

const git = (opts: { root: string; args: string[] }): string | undefined => {
  try {
    const result = Bun.spawnSync(['git', ...opts.args], {
      cwd: opts.root,
      stdout: 'pipe',
      stderr: 'ignore',
    });

    return result.exitCode === 0 ? result.stdout.toString().trim() : undefined;
  } catch {
    return undefined;
  }
};

export const shippedSkillNames = (): string[] => {
  const directory = join(BASE_DIRECTORY, SyncConstants.SKILLS_DIRECTORY);

  return existsSync(directory)
    ? readdirSync(directory, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isDirectory() &&
            existsSync(join(directory, entry.name, SyncConstants.SKILL_FILE)),
        )
        .map((entry) => entry.name)
        .sort()
    : [];
};

/**
 * The files sync creates for the chosen agents, listed in this clone's `.git/info/exclude` (D1): the
 * choice is per developer, so a committed `.gitignore` would flip-flop. A re-run replaces the block, so
 * an agent that is no longer chosen drops out. Paths git tracks are not listed; outside a git
 * repository nothing is written.
 */
export const planExclude = (opts: { root: string; agents: string[] }): ISyncAction[] => {
  const location = git({ root: opts.root, args: ['rev-parse', '--git-path', 'info/exclude'] });

  if (location === undefined || location === '') {
    return [];
  }

  const path = resolve(opts.root, location);
  const prefix = git({ root: opts.root, args: ['rev-parse', '--show-prefix'] }) ?? '';
  const anchored = excludePathsOf({ agents: opts.agents, skillNames: shippedSkillNames() }).map(
    (group) => ({ ...group, paths: group.paths.map((item) => `/${prefix}${item.slice(1)}`) }),
  );
  const candidates = anchored.flatMap((group) => group.paths).filter((item) => !item.endsWith('/'));
  const tracked = new Set(
    (
      git({
        root: opts.root,
        args: ['ls-files', '--', ...candidates.map((item) => item.slice(`/${prefix}`.length))],
      }) ?? ''
    )
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => `/${prefix}${line}`),
  );
  const groups = anchored
    .map((group) => ({ ...group, paths: group.paths.filter((item) => !tracked.has(item)) }))
    .filter((group) => group.paths.length > 0);
  const before = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
  const merged = mergeExcludeBlock({ text: before, block: renderExcludeBlock({ groups }) });

  if (!merged.changed) {
    return [{ path, status: SyncStatuses.UNCHANGED, apply: NO_CHANGE }];
  }

  return [
    {
      path,
      status: before === undefined ? SyncStatuses.CREATED : SyncStatuses.REPLACED,
      apply: () => {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, merged.text);
      },
    },
  ];
};
