import { spawnSync } from 'node:child_process';
import { relative, resolve } from 'node:path';
import { ProjectLayout } from '../common/index.ts';
import { LayoutFolder } from '../common/layout-folder.ts';
import { AgentConstants } from '../agents/common/index.ts';
import { LocalPlan, SyncStatuses } from '../sync/index.ts';
import { BrowserSocket, LocalFormat, LocalScan, LocalStates } from '../local/index.ts';
import { LocalSettings } from '../common/local-settings.ts';
import { HookConstants, ProjectTmp } from '../hooks/index.ts';
import { DoctorChecks } from './common/index.ts';
import type { ICheckContext, IViolation } from './common/index.ts';
import { DoctorCheckUtility } from './utilities/doctor-check.utility.ts';

/** The checks of the local workspace under `.agents/local/` and of the temp folder. */
export class LocalChecks {
  /** `.agents/local/` exists with its subdirectories and is gitignored: `sync` does both, so an upgraded project that has not synced yet is told here. */
  static checkLocalWorkspace(opts: ICheckContext): IViolation[] {
    return LocalPlan.planWorkspace({
      root: opts.root,
      tmp: ProjectTmp.configuredOf({ tmp: opts.config.local.tmp }),
    })
      .filter((action) => action.status !== SyncStatuses.UNCHANGED)
      .map((action) =>
        DoctorCheckUtility.createViolation({
          check: DoctorChecks.LOCAL,
          file: relative(opts.root, action.path) || '.',
          message: `${action.note ?? 'out of date'} - run 'bun node_modules/.bin/vulcan project sync'`,
        }),
      );
  }

  /**
   * What is directly under `.agents/local/` and is not a folder of the layout, a file VULCAN writes, or a browser's
   * scratch folder, in one warning: how many, how big, and their names. Nothing removes them.
   */
  static checkUnknownLocal(opts: ICheckContext): IViolation[] {
    const unknown = LocalScan.unknown({ root: opts.root });

    return unknown.length === 0
      ? []
      : [
          DoctorCheckUtility.createViolation({
            check: DoctorChecks.LOCAL,
            file: ProjectLayout.LOCAL_DIRECTORY,
            message: `${unknown.length} ${unknown.length === 1 ? 'entry is' : 'entries are'} not ${unknown.length === 1 ? 'one' : 'ones'} VULCAN knows: ${unknown
              .slice(0, 10)
              .map((entry) => `${entry.name} (${LocalFormat.formatBytes({ bytes: entry.bytes })})`)
              .join(
                ', ',
              )}${unknown.length > 10 ? `, and ${unknown.length - 10} more` : ''}; put scratch in tmp/ and what you want to keep in reports/, what one agent keeps for itself in agents/<name>/; a script the team relies on belongs in the tracked tree (scripts/), where it gets review and history; nothing removes ${unknown.length === 1 ? 'it' : 'them'}`,
          }),
        ];
  }

  /**
   * What an agent left under `.agents/local/` that has outlived its use, in one warning: how many in each scope, how
   * big, and the command that clears them (which, without `--yes`, lists each one).
   */
  static checkStaleLocal(opts: ICheckContext): IViolation[] {
    const stale = LocalScan.scan({ root: opts.root }).filter((entry) =>
      [
        LocalStates.STALE,
        LocalStates.MERGED,
        LocalStates.GONE,
        LocalStates.ORPHAN,
        LocalStates.SHIPPED,
      ].includes(entry.state),
    );

    if (stale.length === 0) {
      return [];
    }

    const scopes = [...new Set(stale.map((entry) => entry.scope))];
    const counts = new Map<string, number>();

    for (const entry of stale) {
      const group = `${entry.state} in ${entry.scope}`;

      counts.set(group, (counts.get(group) ?? 0) + 1);
    }

    const groups = [...counts.entries()];
    const bytes = stale.reduce((total, entry) => total + entry.bytes, 0);

    return [
      DoctorCheckUtility.createViolation({
        check: DoctorChecks.LOCAL,
        file: ProjectLayout.LOCAL_DIRECTORY,
        message: `${stale.length} ${stale.length === 1 ? 'entry has' : 'entries have'} outlived ${stale.length === 1 ? 'its' : 'their'} use (${LocalFormat.formatBytes({ bytes })}): ${groups.map(([group, count]) => `${count} ${group}`).join(', ')}; run: vulcan project clean ${scopes.map((scope) => `--${scope}`).join(' ')} --yes (without --yes it lists each one)`,
      }),
    ];
  }

  /**
   * What `local.tmp` must hold for `clean` and the hooks to be safe with it, and for a browser to start: it is not a folder
   * of the `layout` (or inside one) and holds no tracked file, because `clean` removes what is old in it; and its browser
   * socket path fits, so the key does what it exists for. Each is a failure here, not a surprise later. A project that does
   * not set the key gets the warning of `checkBrowserSocket`.
   */
  static checkTmpFolder(opts: ICheckContext): IViolation[] {
    const own = LocalSettings.read({ root: opts.root }).tmp;
    const tmp = own ?? opts.config.local.tmp;

    if (tmp === undefined) {
      return [];
    }

    const folder = ProjectTmp.projectOf({ root: resolve(opts.root), tmp });
    const layoutFolders = Object.values(opts.config.layout ?? {}).flatMap((value) =>
      LayoutFolder.layoutFoldersOf({ value }),
    );
    const clash = layoutFolders.find(
      (entry) => entry === tmp || entry.startsWith(`${tmp}/`) || tmp.startsWith(`${entry}/`),
    );
    const tracked = spawnSync('git', ['ls-files', '--', tmp], {
      cwd: opts.root,
      encoding: 'utf8',
      timeout: 5000,
    });
    const hasTracked = tracked.status === 0 && tracked.stdout.trim() !== '';
    const length = BrowserSocket.lengthOf({ folder });
    const problems = [
      ...(clash === undefined
        ? []
        : [`it is, or holds, the layout folder '${clash}': \`clean\` removes old files from it`]),
      ...(hasTracked
        ? [
            `git tracks files in it: \`clean\` removes old files from it. Pick a folder that only holds scratch`,
          ]
        : []),
      ...(BrowserSocket.fits({ folder })
        ? []
        : [
            `its socket path for a browser would be ${length} characters in ${folder} and the limit is ${BrowserSocket.PATH_MAX}. Use a shorter folder name or a shorter checkout path`,
          ]),
    ];

    return problems.map((problem) =>
      DoctorCheckUtility.createViolation({
        check: DoctorChecks.LOCAL,
        file: own === undefined ? opts.configFile : AgentConstants.LOCAL_FILE,
        message: `common.local.tmp '${tmp}': ${problem}`,
      }),
    );
  }

  /**
   * The project's tmp folder is too deep for a browser: Chrome and Chromium put a socket below the temp folder
   * and exit with "Socket path too long" past the limit of a unix socket path (`BrowserSocket.PATH_MAX`, the Linux
   * value; macOS allows 104). The session start points a session's `TMPDIR` at that folder, so a browser it starts
   * (Playwright MCP, a headless Chrome) fails. A warning, because only a
   * project that starts a browser meets it; the way out is a shorter checkout path. The root is made absolute first.
   */
  static checkBrowserSocket(opts: { root: string; tmp?: string }): IViolation[] {
    if (opts.tmp !== undefined) {
      return [];
    }

    const root = resolve(opts.root);
    const folder = ProjectTmp.projectOf({ root, tmp: HookConstants.PROJECT_TMP });
    const length = BrowserSocket.lengthOf({ folder });

    if (BrowserSocket.fits({ folder })) {
      return [];
    }

    const spare = BrowserSocket.PATH_MAX - (length - root.length);

    return [
      DoctorCheckUtility.createViolation({
        check: DoctorChecks.LOCAL,
        file: HookConstants.PROJECT_TMP,
        message: `the temp folder ${folder} is too deep for a browser: Chrome's socket path would be ${length} characters (${BrowserSocket.longest()} below it) and the limit is ${BrowserSocket.PATH_MAX}, so a browser started with this folder exits with "${BrowserSocket.ERROR}". Set \`common.local.tmp\` in the config to a short folder of the project (for example \`tmp\`) and run \`vulcan project sync\`, or move the checkout to a path of ${spare} characters or fewer`,
      }),
    ];
  }
}
