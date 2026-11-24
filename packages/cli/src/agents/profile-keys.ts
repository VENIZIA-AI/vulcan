import { RecordValue } from '../common/record.ts';

/**
 * The machine keys of the profile (`.agents/local/profile.json`) follow the config's groups: `agents` is `agent.list`, `board.agents`
 * is `board.page.agents`, `events` is `board.events`, `local` is `common.local`; `board.serve` stays. Releases before the groups wrote the
 * old paths, and the legacy `.agents/vulcan.local.json` still has them: this is the one place that knows both.
 */
export class ProfileKeys {
  /** The old paths, each with the place it moved to: what the schemas refuse by name and `sync` rewrites once. */
  static readonly MOVES: readonly { from: string; to: string }[] = [
    { from: 'agents', to: 'agent.list' },
    { from: 'board.agents', to: 'board.page.agents' },
    { from: 'events', to: 'board.events' },
    { from: 'local', to: 'common.local' },
  ];

  /** `board` keys that belong to the profile as they are (`serve`) or to the new shape (`page`, `events`): never moved, never left. */
  private static readonly BOARD_KEYS: readonly string[] = ['agents', 'serve', 'page', 'events'];

  private static put(opts: {
    into: Record<string, unknown>;
    path: string[];
    value: unknown;
  }): void {
    let at = opts.into;

    for (const key of opts.path.slice(0, -1)) {
      const next = at[key];

      if (RecordValue.isRecord(next)) {
        at = next;
      } else {
        const made: Record<string, unknown> = {};

        at[key] = made;
        at = made;
      }
    }

    at[opts.path[opts.path.length - 1] ?? ''] = opts.value;
  }

  /** Whether the record has a key of the old shape. */
  static isOld(opts: { value: Record<string, unknown> }): boolean {
    const board = opts.value['board'];

    return (
      ['agents', 'events', 'local'].some((key) => Object.hasOwn(opts.value, key)) ||
      (RecordValue.isRecord(board) && Object.hasOwn(board, 'agents'))
    );
  }

  /**
   * The record with its old keys at their new paths. A value already at the new path wins (`kept` names it, as a new path); a `board`
   * key that is neither old nor new nor `serve` is not placed: it stays where it is and `left` names it. Every other key is copied.
   */
  static toNew(opts: { value: Record<string, unknown> }): {
    value: Record<string, unknown>;
    moved: string[];
    kept: string[];
    left: string[];
  } {
    const value: Record<string, unknown> = {};
    const moved: string[] = [];
    const left: string[] = [];
    const incoming: { to: string; value: unknown; from: string }[] = [];

    for (const [key, entry] of Object.entries(opts.value)) {
      const move = ProfileKeys.MOVES.find((candidate) => candidate.from === key);

      if (move !== undefined) {
        incoming.push({ to: move.to, value: entry, from: key });
      } else if (key === 'board' && RecordValue.isRecord(entry)) {
        const rest: Record<string, unknown> = {};

        for (const [inner, innerValue] of Object.entries(entry)) {
          if (inner === 'agents') {
            incoming.push({ to: 'board.page.agents', value: innerValue, from: 'board.agents' });
          } else {
            rest[inner] = innerValue;

            if (!ProfileKeys.BOARD_KEYS.includes(inner)) {
              left.push(`board.${inner}`);
            }
          }
        }

        value[key] = rest;
      } else {
        value[key] = entry;
      }
    }

    const kept: string[] = [];

    for (const item of incoming) {
      const exists = ProfileKeys.at({ value, path: item.to.split('.') });

      if (exists === undefined) {
        ProfileKeys.put({ into: value, path: item.to.split('.'), value: item.value });
        moved.push(`${item.from} -> ${item.to}`);

        continue;
      }

      const merged = ProfileKeys.merge({ incoming: item.value, own: exists.value, path: item.to });

      ProfileKeys.put({ into: value, path: item.to.split('.'), value: merged.value });
      kept.push(...merged.kept);
      moved.push(`${item.from} -> ${item.to}`);
    }

    return { value, moved, kept, left };
  }

  private static at(opts: {
    value: Record<string, unknown>;
    path: string[];
  }): { value: unknown } | undefined {
    let at: unknown = opts.value;

    for (const key of opts.path) {
      if (!RecordValue.isRecord(at) || !Object.hasOwn(at, key)) {
        return undefined;
      }

      at = at[key];
    }

    return { value: at };
  }

  /** `incoming` under `own`, recursively: a leaf both have keeps `own`'s value and is named in `kept` when the two differ. */
  static merge(opts: { incoming: unknown; own: unknown; path: string }): {
    value: unknown;
    kept: string[];
  } {
    // The roster of the board replaces whole, as it does over the committed config: two rosters are not mixed.
    if (
      RecordValue.isRecord(opts.incoming) &&
      RecordValue.isRecord(opts.own) &&
      opts.path !== 'board.page.agents'
    ) {
      const value: Record<string, unknown> = { ...opts.incoming };
      const kept: string[] = [];

      for (const [key, own] of Object.entries(opts.own)) {
        if (Object.hasOwn(opts.incoming, key)) {
          const inner = ProfileKeys.merge({
            incoming: opts.incoming[key],
            own,
            path: opts.path === '' ? key : `${opts.path}.${key}`,
          });

          value[key] = inner.value;
          kept.push(...inner.kept);
        } else {
          value[key] = own;
        }
      }

      return { value, kept };
    }

    return {
      value: opts.own,
      kept: JSON.stringify(opts.incoming) === JSON.stringify(opts.own) ? [] : [opts.path],
    };
  }
}
