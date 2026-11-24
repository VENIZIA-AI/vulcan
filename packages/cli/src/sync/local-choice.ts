import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { LOCAL_AGENTS_FILE, LocalChoice } from '../agents/index.ts';
import { AgentConstants } from '../agents/common/constants.ts';
import { OwnerProfile } from '../owner/profile.ts';
import { ProjectLayout } from '../common/index.ts';
import { ProjectTmp } from '../hooks/project-tmp.ts';
import { AgentFiles } from './agent-files.ts';
import { SyncStatuses } from './common/index.ts';
import type { ISyncAction } from './common/index.ts';

const NO_CHANGE = (): void => {};

/** The file an earlier release wrote for `claude --settings`; nothing writes or reads it now. */
const LEGACY_LAUNCH_FILE = `${ProjectLayout.LOCAL_DIRECTORY}/claude.launch.settings.json`;

/** One line sync adds to a committed `.gitignore`; a project without one is left alone. */
const planIgnoreLine = (opts: {
  root: string;
  line: string;
  /** Lines that already ignore what `line` ignores: with one of them there, nothing is added. */
  covered?: string[];
}): ISyncAction[] => {
  const path = join(opts.root, '.gitignore');

  if (!existsSync(path)) {
    return [];
  }

  const text = readFileSync(path, 'utf8');

  if (text.split('\n').some((line) => [opts.line, ...(opts.covered ?? [])].includes(line.trim()))) {
    return [];
  }

  return [
    {
      path,
      status: SyncStatuses.REPLACED,
      note: `added ${opts.line}`,
      // Read again when it runs: several lines are added to the same file by actions planned from one reading.
      apply: () => {
        const current = readFileSync(path, 'utf8');

        if (current.split('\n').some((line) => line.trim() === opts.line)) {
          return;
        }

        writeFileSync(
          path,
          `${current}${current === '' || current.endsWith('\n') ? '' : '\n'}${opts.line}\n`,
        );
      },
    },
  ];
};

export class LocalPlan {
  /** The developer's stored agents: written when the machine just chose, reported unchanged when it was read. */
  static planChoice(opts: { root: string; agents: string[] }): ISyncAction {
    const path = join(opts.root, LOCAL_AGENTS_FILE);

    if (OwnerProfile.linkedAt({ root: opts.root }) !== undefined) {
      return {
        path,
        status: SyncStatuses.SKIPPED,
        note: `${LOCAL_AGENTS_FILE} (or .agents/local) is a symlink: the choice was not written`,
        apply: NO_CHANGE,
      };
    }

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
   * The file of the releases before 0.5.0 (`.agents/vulcan.local.json`): its machine keys move into the profile first (the
   * profile's own value winning where both have one, one level down for `board`, `local` and `events`), and only then is the
   * file removed: when git does not track it and it holds no key the profile does not know. A tracked file, one git could not
   * be asked about, or one with an unknown key stays, and the note says what to do (sync runs no git write).
   */
  static planLegacyLocal(opts: { root: string }): ISyncAction[] {
    const path = join(opts.root, AgentConstants.LEGACY_LOCAL_FILE);

    if (!existsSync(path)) {
      return [];
    }

    const target = join(opts.root, LOCAL_AGENTS_FILE);
    const moved = LocalChoice.migrate({ root: opts.root });

    if ('failed' in moved) {
      return [
        {
          path: moved.failed === 'old' ? path : target,
          status: SyncStatuses.SKIPPED,
          note:
            moved.failed === 'old'
              ? `${AgentConstants.LEGACY_LOCAL_FILE} cannot be read as JSON: fix or delete it, its keys belong in ${LOCAL_AGENTS_FILE}`
              : `${LOCAL_AGENTS_FILE} cannot be read as JSON, so the keys of ${AgentConstants.LEGACY_LOCAL_FILE} were not moved: fix the profile, then run sync again`,
          apply: NO_CHANGE,
        },
      ];
    }

    if (OwnerProfile.linkedAt({ root: opts.root }) !== undefined) {
      return [
        {
          path: target,
          status: SyncStatuses.SKIPPED,
          note: `${LOCAL_AGENTS_FILE} (or .agents/local) is a symlink: nothing was moved or written`,
          apply: NO_CHANGE,
        },
      ];
    }

    const state = AgentFiles.trackState({
      root: opts.root,
      path: AgentConstants.LEGACY_LOCAL_FILE,
    });
    const isRemoved = state === 'untracked' && moved.left.length === 0;
    const saying = [
      `its keys moved into ${LOCAL_AGENTS_FILE}`,
      ...(moved.kept.length === 0
        ? []
        : [`the profile's own value was kept for ${moved.kept.join(', ')}`]),
      ...(moved.left.length === 0
        ? []
        : [
            `${moved.left.join(', ')} ${moved.left.length === 1 ? 'is' : 'are'} not ${moved.left.length === 1 ? 'a key' : 'keys'} the profile takes, so the file stays: fix or delete ${moved.left.length === 1 ? 'it' : 'them'}`,
          ]),
      ...(state === 'tracked'
        ? [
            `git tracks this file: run git rm --cached ${AgentConstants.LEGACY_LOCAL_FILE}, then delete it`,
          ]
        : state === 'unknown'
          ? ['git could not say whether it tracks this file: delete it by hand']
          : []),
    ].join('; ');

    return [
      {
        path,
        status: isRemoved ? SyncStatuses.REMOVED : SyncStatuses.REPLACED,
        note: saying,
        apply: () => {
          const again = LocalChoice.migrate({ root: opts.root });

          if (!('text' in again)) {
            return;
          }

          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, again.text, { mode: 0o600 });

          if (isRemoved) {
            rmSync(path, { force: true });
          }
        },
      },
    ];
  }

  /**
   * `opts.tmp` is the committed `local.tmp` (or the default, `.agents/tmp`). Its folder is gitignored in the committed
   * `.gitignore` whoever runs sync: it is never under the `.agents/local/` that is ignored whole. The folder this checkout names
   * in its local file (else the same one) is made; its ignore line is in `.git/info/exclude` (`ExcludePlan`).
   */
  static planTmp(opts: { root: string; tmp?: string }): ISyncAction[] {
    const configured = ProjectTmp.configuredOf({ tmp: opts.tmp });
    const committed = join(opts.root, configured);
    const tmp = join(opts.root, ProjectTmp.effectiveOf({ root: opts.root, tmp: configured }));
    const isMade = existsSync(tmp);
    const made: ISyncAction = {
      path: tmp,
      status: isMade ? SyncStatuses.UNCHANGED : SyncStatuses.CREATED,
      ...(isMade ? {} : { note: 'the project tmp folder, local.tmp' }),
      apply: () => {
        mkdirSync(tmp, { recursive: true });
      },
    };

    const folder = relative(opts.root, committed);
    // The folder the default names is `.agents/tmp`: its parent, `.agents`, is only a cover when the committed folder is under it.
    const parent = dirname(ProjectLayout.TMP_DIRECTORY);
    const parents = folder.startsWith(`${parent}/`)
      ? [parent, `${parent}/`, `/${parent}`, `/${parent}/`]
      : [];

    return [
      ...planIgnoreLine({
        root: opts.root,
        line: `/${folder}/`,
        // A line that already ignores the folder, whole or from its parent: no near-duplicate is added.
        covered: [folder, `${folder}/`, `/${folder}`, ...parents],
      }),
      made,
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
    // `tmp` is the scratch folder of `planTmp` now (`.agents/tmp`, or `local.tmp`): `.agents/local/tmp` of an earlier release is left alone.
    const missing = ProjectLayout.LOCAL_LAYOUT.filter((entry) => !('onDemand' in entry))
      .map((entry) => entry.name)
      .filter((name) => name !== 'tmp')
      .filter((name) => !existsSync(join(directory, name)));

    return [
      ...planIgnoreLine({ root: opts.root, line: `${ProjectLayout.LOCAL_DIRECTORY}/` }),
      // Claude Code's settings are written by sync in every clone: they are never committed.
      ...planIgnoreLine({
        root: opts.root,
        line: `/${ProjectLayout.CLAUDE_SETTINGS_FILE}`,
        covered: [
          '.claude/',
          '.claude',
          '/.claude/',
          '/.claude',
          ProjectLayout.CLAUDE_SETTINGS_FILE,
        ],
      }),
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
