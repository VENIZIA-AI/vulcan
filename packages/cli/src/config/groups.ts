import { RecordValue } from '../common/record.ts';

/** Where each key of a group lands in the flat config the readers use: `to` is the flat top-level key, `inner` a key inside it. */
interface IGroupKey {
  to: string;
  inner?: string;
}

/**
 * The seven groups of the config's top level and the key each of their keys has in the flat config the commands read. The grouped
 * file is the public shape; `toFlat` turns it into the flat one before validation, so the schema, the layers and every reader stay as
 * they are. `guard` is one key that moves whole.
 */
export class ConfigGroups {
  static readonly GROUPS: Readonly<Record<string, Readonly<Record<string, IGroupKey>>>> = {
    project: {
      name: { to: 'name' },
      key: { to: 'project', inner: 'key' },
      layout: { to: 'layout' },
      packages: { to: 'packages' },
      presets: { to: 'presets' },
    },
    agent: {
      list: { to: 'agents' },
      packs: { to: 'packs' },
      rules: { to: 'rules' },
      digest: { to: 'digest' },
      owner: { to: 'owner' },
      claude: { to: 'claude' },
    },
    board: {
      events: { to: 'events' },
      page: { to: 'board' },
      provider: { to: 'provider' },
    },
    check: {
      doctor: { to: 'doctor' },
      commit: { to: 'commit' },
      layout: { to: 'doctor', inner: 'layout' },
    },
    common: {
      theme: { to: 'theme' },
      local: { to: 'local' },
      remove: { to: 'remove' },
    },
  };

  /** `knowledge` keeps its own keys and takes `okf` and `atlas`; `guard` is the key `guard`. */
  static readonly KNOWLEDGE_TOOLS: readonly string[] = ['okf', 'atlas'];

  static names(): string[] {
    return ['project', 'agent', 'guard', 'board', 'knowledge', 'check', 'common'];
  }

  /**
   * Whether a config is written in the flat shape: it has a top-level key that exists only there (`agents`, `okf`, `events`...), or a
   * `board` with a key of the old page settings. A config with only keys the two shapes share is read as grouped (it means the same).
   */
  static isFlat(opts: { value: Record<string, unknown> }): boolean {
    const grouped = ConfigGroups.names();
    const board = opts.value['board'];
    const oldBoard = RecordValue.isRecord(board)
      ? Object.keys(board).some((key) => !ConfigGroups.GROUPS['board'][key])
      : false;

    return Object.keys(opts.value).some((key) => !grouped.includes(key)) || oldBoard;
  }

  /**
   * A grouped config as the flat one: each group's keys moved to their flat places. A key a group does not have, or a group that is
   * not an object, is an issue named by its grouped path (a typo is an error, as it is in the flat shape).
   */
  static toFlat(opts: { value: Record<string, unknown> }): {
    flat: Record<string, unknown>;
    issues: string[];
  } {
    const flat: Record<string, unknown> = {};
    const issues: string[] = [];
    const put = (key: string, inner: string | undefined, value: unknown): void => {
      if (inner === undefined) {
        const existing = flat[key];

        // `check.layout` may have been put into `doctor` before `check.doctor`: the keys of both stay.
        flat[key] =
          RecordValue.isRecord(existing) && RecordValue.isRecord(value)
            ? { ...value, ...existing }
            : value;

        return;
      }

      const into = RecordValue.isRecord(flat[key]) ? flat[key] : {};

      flat[key] = { ...into, [inner]: value };
    };

    for (const [group, value] of Object.entries(opts.value)) {
      if (group === 'guard') {
        flat['guard'] = value;
        continue;
      }

      if (value === undefined) {
        continue;
      }

      if (!RecordValue.isRecord(value)) {
        issues.push(`${group}: expected an object`);
        continue;
      }

      if (group === 'knowledge') {
        const { okf, atlas, ...own } = value;

        flat['knowledge'] = own;

        if ('okf' in value) {
          flat['okf'] = okf;
        }

        if ('atlas' in value) {
          flat['atlas'] = atlas;
        }

        continue;
      }

      const keys = ConfigGroups.GROUPS[group];

      for (const [key, inner] of Object.entries(value)) {
        const target = keys?.[key];

        if (target === undefined) {
          issues.push(
            `${group}.${key}: not a key of ${group} (one of ${Object.keys(keys ?? {}).join(', ')})`,
          );
          continue;
        }

        put(target.to, target.inner, inner);
      }
    }

    return { flat, issues };
  }
}
