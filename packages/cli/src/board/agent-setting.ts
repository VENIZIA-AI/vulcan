import type { TBoardAgentSetting } from './schema.ts';

/** What one `board.agents` entry says: its face, its lane, and why a lane cannot be honoured. */
export class BoardAgentSetting {
  static shapeOf(opts: { setting: TBoardAgentSetting }): string | undefined {
    return typeof opts.setting === 'string' ? opts.setting : opts.setting.shape;
  }

  static laneOf(opts: { setting: TBoardAgentSetting }): string | undefined {
    return typeof opts.setting === 'string' ? undefined : opts.setting.lane;
  }

  static roleOf(opts: { setting: TBoardAgentSetting }): string | undefined {
    return typeof opts.setting === 'string' ? undefined : opts.setting.role;
  }

  /** Why the lane of `name` cannot be honoured, or `undefined`. A lane names a listed agent with no lane of its own, so there is no chain and no cycle. */
  static problemOf(opts: {
    settings: Record<string, TBoardAgentSetting>;
    name: string;
  }): string | undefined {
    const { settings, name } = opts;
    const lane = BoardAgentSetting.laneOf({ setting: settings[name] });

    if (lane === undefined) {
      return undefined;
    }

    if (lane === name) {
      return `'${name}' cannot be its own lane`;
    }

    const target = settings[lane];

    if (target === undefined) {
      return `lane '${lane}' of '${name}' is not a key of board.agents`;
    }

    return BoardAgentSetting.laneOf({ setting: target }) === undefined
      ? undefined
      : `lane '${lane}' of '${name}' has a lane of its own: a lane cannot be a helper`;
  }
}
