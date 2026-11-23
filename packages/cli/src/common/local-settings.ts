import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentConstants } from '../agents/common/constants.ts';
import { LayoutFolder } from './layout-folder.ts';
import { RecordValue } from './record.ts';

/**
 * The config keys a person may set for this checkout in `.agents/vulcan.local.json`: `local.tmp`, `board.agents` and
 * `events.dir` (read by `EventSettings`, which the event hook must load without this module). Read by hooks and the board
 * page, so it never throws and checks nothing but the shape of a folder: a value it cannot use is left out and the
 * committed one applies. `vulcan doctor` says what is wrong.
 */
export class LocalSettings {
  static read(opts: { root: string }): {
    tmp?: string;
    boardAgents?: unknown;
    autoStart?: boolean;
  } {
    try {
      const file: unknown = JSON.parse(
        readFileSync(join(opts.root, AgentConstants.LOCAL_FILE), 'utf8'),
      );
      const local = RecordValue.isRecord(file) ? file['local'] : undefined;
      const board = RecordValue.isRecord(file) ? file['board'] : undefined;
      const tmp = RecordValue.isRecord(local) ? local['tmp'] : undefined;
      const agents = RecordValue.isRecord(board) ? board['agents'] : undefined;
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
    } catch {
      return {};
    }
  }
}
