import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { LOCAL_AGENTS_FILE, renderLocalChoice } from '../agents/index.ts';
import { ProjectLayout } from '../common/index.ts';
import { planClaudeLaunch } from './claude-launch.ts';
import { SyncStatuses } from './common/index.ts';
import type { ISyncAction } from './common/index.ts';

const NO_CHANGE = (): void => {};

/** The developer's stored agents: written when the machine just chose, reported unchanged when it was read. */
export const planLocalChoice = (opts: { root: string; agents: string[] }): ISyncAction => {
  const path = join(opts.root, LOCAL_AGENTS_FILE);
  const text = renderLocalChoice({ agents: opts.agents });
  const before = existsSync(path) ? readFileSync(path, 'utf8') : undefined;

  if (before === text) {
    return { path, status: SyncStatuses.UNCHANGED, apply: NO_CHANGE };
  }

  return {
    path,
    status: before === undefined ? SyncStatuses.CREATED : SyncStatuses.REPLACED,
    apply: () => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    },
  };
};

/** One line sync adds to a committed `.gitignore`; a project without one is left alone. */
const planIgnoreLine = (opts: { root: string; line: string }): ISyncAction[] => {
  const path = join(opts.root, '.gitignore');

  if (!existsSync(path)) {
    return [];
  }

  const text = readFileSync(path, 'utf8');

  if (text.split('\n').some((line) => line.trim() === opts.line)) {
    return [];
  }

  return [
    {
      path,
      status: SyncStatuses.REPLACED,
      note: `added ${opts.line}`,
      apply: () =>
        writeFileSync(
          path,
          `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}${opts.line}\n`,
        ),
    },
  ];
};

/** The one line sync adds to a committed `.gitignore`; a project without one is left alone. */
export const planLocalIgnore = (opts: { root: string }): ISyncAction[] =>
  planIgnoreLine({ root: opts.root, line: LOCAL_AGENTS_FILE });

/**
 * The project's local workspace: `.agents/local/` is gitignored and holds what an agent creates while
 * it works (scratch, worktrees, clones, cache, prototypes), so nothing lands outside the project.
 */
export const planLocalWorkspace = (opts: { root: string }): ISyncAction[] => {
  const directory = join(opts.root, ProjectLayout.LOCAL_DIRECTORY);
  const missing = ProjectLayout.LOCAL_LAYOUT.map((entry) => entry.name).filter(
    (name) => !existsSync(join(directory, name)),
  );

  return [
    ...planIgnoreLine({ root: opts.root, line: `${ProjectLayout.LOCAL_DIRECTORY}/` }),
    ...planClaudeLaunch({ root: opts.root }),
    {
      path: directory,
      status: missing.length === 0 ? SyncStatuses.UNCHANGED : SyncStatuses.CREATED,
      ...(missing.length === 0 ? {} : { note: `created ${missing.join(', ')}` }),
      apply: () => {
        for (const name of missing) {
          mkdirSync(join(directory, name), { recursive: true });
        }
      },
    },
  ];
};
