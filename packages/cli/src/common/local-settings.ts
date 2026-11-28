import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentConstants } from '../agents/common/constants.ts';
import { LayoutFolder } from './layout-folder.ts';
import { RecordValue } from './record.ts';
import { FallbackUtility } from './utilities/fallback.utility.ts';

/**
 * The config keys a person may set for this checkout in the profile, `.agents/local/profile.json`: `common.local.tmp`, `board.page.agents` and
 * `board.events.dir` (read by `EventSettings`, which the event hook must load without this module). Read by hooks and the board
 * page, so it never throws and checks nothing but the shape of a folder: a value it cannot use is left out and the
 * committed one applies. `vulcan project doctor` says what is wrong.
 */
export class LocalSettings {
  static read(opts: { root: string }): {
    tmp?: string;
    boardAgents?: unknown;
    autoStart?: boolean;
  } {
    // The profile first, then the file of the releases before 0.5.0, key by key: a clone not yet synced since the upgrade keeps its settings.
    const own = LocalSettings.readFile({ file: AgentConstants.LOCAL_FILE, root: opts.root });
    const old = LocalSettings.readFile({
      file: AgentConstants.LEGACY_LOCAL_FILE,
      root: opts.root,
      isLegacy: true,
    });

    return { ...old, ...own };
  }

  /** The profile has the keys in the groups of the config (`common.local.tmp`, `board.page.agents`); the file of the releases before 0.5.0 has the old paths (`local.tmp`, `board.agents`). */
  private static readFile(opts: { root: string; file: string; isLegacy?: boolean }): {
    tmp?: string;
    boardAgents?: unknown;
    autoStart?: boolean;
  } {
    return FallbackUtility.of({
      read: () => {
        const file: unknown = JSON.parse(readFileSync(join(opts.root, opts.file), 'utf8'));
        const common = RecordValue.isRecord(file) ? file['common'] : undefined;
        const local =
          opts.isLegacy === true
            ? RecordValue.isRecord(file)
              ? file['local']
              : undefined
            : RecordValue.isRecord(common)
              ? common['local']
              : undefined;
        const board = RecordValue.isRecord(file) ? file['board'] : undefined;
        const tmp = RecordValue.isRecord(local) ? local['tmp'] : undefined;
        const page = RecordValue.isRecord(board) ? board['page'] : undefined;
        const agents =
          opts.isLegacy === true
            ? RecordValue.isRecord(board)
              ? board['agents']
              : undefined
            : RecordValue.isRecord(page)
              ? page['agents']
              : undefined;
        const serve = RecordValue.isRecord(board) ? board['serve'] : undefined;
        const autoStart = RecordValue.isRecord(serve) ? serve['autoStart'] : undefined;

        return {
          ...(typeof tmp === 'string' &&
          LayoutFolder.layoutFolderProblem({ folder: tmp }) === undefined
            ? { tmp }
            : {}),
          ...(RecordValue.isRecord(agents) ? { boardAgents: agents } : {}),
          ...(typeof autoStart === 'boolean' ? { autoStart } : {}),
        };
      },
      otherwise: {},
    });
  }
}
