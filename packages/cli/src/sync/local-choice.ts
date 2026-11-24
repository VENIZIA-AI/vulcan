import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { LOCAL_AGENTS_FILE, LocalChoice } from '../agents/index.ts';
import { AgentConstants } from '../agents/common/constants.ts';
import { ProjectLayout } from '../common/index.ts';
import { HookConstants } from '../hooks/common/index.ts';
import { ProjectTmp } from '../hooks/project-tmp.ts';
import { AgentFiles } from './agent-files.ts';
import { SyncStatuses } from './common/index.ts';
import type { ISyncAction } from './common/index.ts';

const NO_CHANGE = (): void => {};

/** The file an earlier release wrote for `claude --settings`; nothing writes or reads it now. */
const LEGACY_LAUNCH_FILE = `${ProjectLayout.LOCAL_DIRECTORY}/claude.launch.settings.json`;

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
    const before = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
    const text = LocalChoice.render({ agents: opts.agents, previous: before });

    if (before === text) {
      return { path, status: SyncStatuses.UNCHANGED, apply: NO_CHANGE };
    }

    return {
      path,
      status: before === undefined ? SyncStatuses.CREATED : SyncStatuses.REPLACED,
      // Rendered again when it runs: the move of the old file's keys may have written the profile since this was planned.
      apply: () => {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(
          path,
          LocalChoice.render({
            agents: opts.agents,
            ...(existsSync(path) ? { previous: readFileSync(path, 'utf8') } : {}),
          }),
          { mode: 0o600 },
        );
      },
    };
  }

  /**
   * The file of the releases before 0.5.0 (`.agents/vulcan.local.json`): its keys move into the profile, the profile's own
   * value winning where both have one, and the file is removed when git does not track it. A tracked file, or one that git could not
   * be asked about, stays and the note says what to do (sync runs no git write).
   */
  static planLegacyLocal(opts: { root: string }): ISyncAction[] {
    const path = join(opts.root, AgentConstants.LEGACY_LOCAL_FILE);

    if (!existsSync(path)) {
      return [];
    }

    const state = AgentFiles.trackState({
      root: opts.root,
      path: AgentConstants.LEGACY_LOCAL_FILE,
    });
    const moved = LocalChoice.migrate({ root: opts.root });
    const target = join(opts.root, LOCAL_AGENTS_FILE);

    if (state !== 'untracked' || moved === undefined) {
      return [
        {
          path,
          status: SyncStatuses.SKIPPED,
          note:
            moved === undefined
              ? `${AgentConstants.LEGACY_LOCAL_FILE} cannot be read: fix or delete it, its keys belong in ${LOCAL_AGENTS_FILE}`
              : state === 'tracked'
                ? `its keys belong in ${LOCAL_AGENTS_FILE} now and git tracks this file: run git rm ${AgentConstants.LEGACY_LOCAL_FILE}`
                : `its keys belong in ${LOCAL_AGENTS_FILE} now, but git could not say whether it tracks this file: delete it by hand`,
          apply: NO_CHANGE,
        },
      ];
    }

    return [
      {
        path,
        status: SyncStatuses.REMOVED,
        note: `its keys moved into ${LOCAL_AGENTS_FILE}${moved.kept.length === 0 ? '' : `; the profile's own value was kept for ${moved.kept.join(', ')}`}`,
        apply: () => {
          const text = LocalChoice.migrate({ root: opts.root })?.text;

          if (text !== undefined) {
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, text, { mode: 0o600 });
            rmSync(path, { force: true });
          }
        },
      },
    ];
  }

  /**
   * `opts.tmp` is the committed `local.tmp` (or the default). Its folder is gitignored in the committed `.gitignore`
   * whoever runs sync: a name is never hidden, so it is never under the `.agents/local/` that is ignored whole. The
   * folder this checkout names in its local file (else the same one) is only made; its ignore line is in
   * `.git/info/exclude` (`ExcludePlan`). The default folder is one of the layout's.
   */
  static planTmp(opts: { root: string; tmp?: string }): ISyncAction[] {
    const configured = ProjectTmp.configuredOf({ tmp: opts.tmp });
    const committed = join(opts.root, configured);
    const tmp = join(opts.root, ProjectTmp.effectiveOf({ root: opts.root, tmp: configured }));
    const isDefault = (folder: string): boolean =>
      folder === join(opts.root, HookConstants.PROJECT_TMP);
    const isMade = existsSync(tmp);
    const made: ISyncAction = {
      path: tmp,
      status: isMade ? SyncStatuses.UNCHANGED : SyncStatuses.CREATED,
      ...(isMade ? {} : { note: 'the project tmp folder, local.tmp' }),
      apply: () => {
        mkdirSync(tmp, { recursive: true });
      },
    };

    return [
      ...(isDefault(committed)
        ? []
        : planIgnoreLine({ root: opts.root, line: `/${relative(opts.root, committed)}/` })),
      ...(isDefault(tmp) ? [] : [made]),
    ];
  }

  /** The launch file of an earlier release, left behind: removed when git does not track it (sync never runs a git write). */
  static planLegacyLaunch(opts: { root: string }): ISyncAction[] {
    const path = join(opts.root, LEGACY_LAUNCH_FILE);

    if (!existsSync(path)) {
      return [];
    }

    const state = AgentFiles.trackState({ root: opts.root, path: LEGACY_LAUNCH_FILE });

    if (state !== 'untracked') {
      return [
        {
          path,
          status: SyncStatuses.SKIPPED,
          note:
            state === 'tracked'
              ? `the Claude Code launch file is no longer used and git tracks it: run git rm --cached ${LEGACY_LAUNCH_FILE}, then delete it`
              : `the Claude Code launch file is no longer used, but git could not say whether it tracks it: remove it by hand`,
          apply: NO_CHANGE,
        },
      ];
    }

    return [
      {
        path,
        status: SyncStatuses.REMOVED,
        note: 'the Claude Code launch file is no longer used',
        apply: () => rmSync(path, { force: true }),
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
      ...LocalPlan.planLegacyLocal({ root: opts.root }),
      ...LocalPlan.planTmp(opts),
      ...LocalPlan.planLegacyLaunch({ root: opts.root }),
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
