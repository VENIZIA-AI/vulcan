import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { LOCAL_AGENTS_FILE, LocalChoice } from '../agents/index.ts';
import { ProjectLayout } from '../common/index.ts';
import { HookConstants } from '../hooks/common/index.ts';
import { ProjectTmp } from '../hooks/project-tmp.ts';
import { LaunchSettings } from './claude-launch.ts';
import { SyncStatuses } from './common/index.ts';
import type { ISyncAction } from './common/index.ts';

const NO_CHANGE = (): void => {};

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

export class LocalPlan {
  /** The developer's stored agents: written when the machine just chose, reported unchanged when it was read. */
  static planChoice(opts: { root: string; agents: string[] }): ISyncAction {
    const path = join(opts.root, LOCAL_AGENTS_FILE);
    const text = LocalChoice.render({ agents: opts.agents });
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
  }

  /** The one line sync adds to a committed `.gitignore`; a project without one is left alone. */
  static planIgnore(opts: { root: string }): ISyncAction[] {
    return planIgnoreLine({ root: opts.root, line: LOCAL_AGENTS_FILE });
  }

  /**
   * The folder `local.tmp` names, when it is not the default one: made, and gitignored when it sits outside
   * `.agents/local/` (which is ignored whole). The default folder is one of the layout's and needs nothing more.
   */
  static planTmp(opts: { root: string; tmp?: string }): ISyncAction[] {
    const tmp = ProjectTmp.projectOf(opts);

    if (tmp === join(opts.root, HookConstants.PROJECT_TMP)) {
      return [];
    }

    const isInLocal = !relative(join(opts.root, ProjectLayout.LOCAL_DIRECTORY), tmp).startsWith(
      '..',
    );
    const isMade = existsSync(tmp);

    return [
      ...(isInLocal
        ? []
        : planIgnoreLine({ root: opts.root, line: `/${relative(opts.root, tmp)}/` })),
      {
        path: tmp,
        status: isMade ? SyncStatuses.UNCHANGED : SyncStatuses.CREATED,
        ...(isMade ? {} : { note: 'the project tmp folder, local.tmp' }),
        apply: () => {
          mkdirSync(tmp, { recursive: true });
        },
      },
    ];
  }

  /**
   * The project's local workspace: `.agents/local/` is gitignored and holds what an agent creates while
   * it works (scratch, worktrees, clones, cache, prototypes), so nothing lands outside the project.
   */
  static planWorkspace(opts: { root: string; tmp?: string }): ISyncAction[] {
    const directory = join(opts.root, ProjectLayout.LOCAL_DIRECTORY);
    const missing = ProjectLayout.LOCAL_LAYOUT.filter((entry) => !('onDemand' in entry))
      .map((entry) => entry.name)
      .filter((name) => !existsSync(join(directory, name)));

    return [
      ...planIgnoreLine({ root: opts.root, line: `${ProjectLayout.LOCAL_DIRECTORY}/` }),
      ...LocalPlan.planTmp(opts),
      ...LaunchSettings.planClaude(opts),
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
  }
}
