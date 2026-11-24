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

  /**
   * Each flat prefix and the grouped one it has (`atlas` is `knowledge.atlas`, `doctor.layout` is `check.layout`, `board` is
   * `board.page`): the one table that `flatPathOf` and `groupedPathOf` read, the longest prefix first.
   */
  private static prefixes(): { flat: string; grouped: string }[] {
    return [
      ...Object.entries(ConfigGroups.GROUPS).flatMap(([group, keys]) =>
        Object.entries(keys).map(([key, target]) => ({
          flat: target.inner === undefined ? target.to : `${target.to}.${target.inner}`,
          grouped: `${group}.${key}`,
        })),
      ),
      { flat: 'knowledge', grouped: 'knowledge' },
      { flat: 'okf', grouped: 'knowledge.okf' },
      { flat: 'atlas', grouped: 'knowledge.atlas' },
      { flat: 'guard', grouped: 'guard' },
    ].sort((left, right) => right.flat.length - left.flat.length);
  }

  private static retarget(opts: { path: string; from: 'flat' | 'grouped' }): string {
    const to = opts.from === 'flat' ? 'grouped' : 'flat';
    const own = ConfigGroups.prefixes()
      .map((entry) => ({ from: entry[opts.from], to: entry[to] }))
      .sort((left, right) => right.from.length - left.from.length)
      .find(
        (entry) =>
          opts.path === entry.from ||
          opts.path.startsWith(`${entry.from}.`) ||
          opts.path.startsWith(`${entry.from}[`),
      );

    return own === undefined ? opts.path : `${own.to}${opts.path.slice(own.from.length)}`;
  }

  /** The grouped path of a flat dotted path (`atlas.sources[x]` is `knowledge.atlas.sources[x]`): what a message shows. */
  static groupedPathOf(opts: { path: string }): string {
    return ConfigGroups.retarget({ path: opts.path, from: 'flat' });
  }

  /** An entry of the form `<path>: <what>` (a `remove` that matched nothing) with the path in its grouped form. */
  static groupedEntryOf(opts: { entry: string }): string {
    const at = opts.entry.indexOf(': ');

    return at === -1
      ? opts.entry
      : `${ConfigGroups.groupedPathOf({ path: opts.entry.slice(0, at) })}${opts.entry.slice(at)}`;
  }

  /** The flat dotted path of a grouped one: where the merge and `remove` look. */
  static flatPathOf(opts: { path: string }): string {
    return ConfigGroups.retarget({ path: opts.path, from: 'grouped' });
  }

  /**
   * The grouped paths a shipped layer (the defaults, a pack) may set, as a rule on the top key and, for a mixed group, the key inside:
   * what is generic or stack specific. A project's own facts (its name, layout, packages, owner, packs, agents) are not defaults.
   */
  static strayOfShipped(opts: { value: Record<string, unknown> }): string[] {
    const allowed: Record<string, string[] | true> = {
      guard: true,
      check: true,
      project: ['presets'],
      agent: ['claude', 'digest'],
      knowledge: true,
    };

    return Object.entries(opts.value).flatMap(([group, inner]) => {
      const rule = allowed[group];

      if (rule === undefined) {
        return [group];
      }

      if (rule === true || !RecordValue.isRecord(inner)) {
        return group === 'knowledge' && RecordValue.isRecord(inner) && 'okf' in inner
          ? [`${group}.okf`]
          : [];
      }

      return Object.keys(inner)
        .filter((key) => !rule.includes(key))
        .map((key) => `${group}.${key}`);
    });
  }

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

        if (
          group === 'check' &&
          key === 'doctor' &&
          RecordValue.isRecord(inner) &&
          'layout' in inner
        ) {
          issues.push('check.doctor.layout: the layout check is `check.layout`');
          continue;
        }

        put(
          target.to,
          target.inner,
          group === 'common' && key === 'remove' && RecordValue.isRecord(inner)
            ? Object.fromEntries(
                Object.entries(inner).map(([path, items]) => [
                  ConfigGroups.flatPathOf({ path }),
                  items,
                ]),
              )
            : inner,
        );
      }
    }

    return { flat, issues };
  }
}
