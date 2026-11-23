import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_DIRECTORY } from '../common/paths.ts';
import { RecordValue } from '../common/record.ts';
import { RulePacks } from '../rules/packs.ts';
import { ConfigConstants } from './common/index.ts';
import { VULCAN_CONFIG_SCHEMA } from './schema.ts';

/** One layer of the config: the shipped defaults, a pack's config, or the project's own file. */
export interface IConfigLayer {
  name: string;
  value: Record<string, unknown>;
}

/** What a merge gives back: the merged object, where each value came from, and the `remove` entries that matched nothing. */
export interface IConfigMerge {
  value: Record<string, unknown>;
  /** The last layer that set each scalar (`digest.x`) and each array item (`presets[<spec>]`), by dotted path. */
  from: Record<string, string>;
  unmatched: string[];
}

const PROJECT_LAYER = 'project';
const DEFAULTS_FILE = 'defaults.config.json';
/** The keys a shipped layer may set: what is generic or stack specific. A project's own facts (name, layout, packages, owner...) are not defaults. */
const SHIPPED_MASK = {
  claude: true,
  presets: true,
  atlas: true,
  digest: true,
  guard: true,
  commit: true,
  doctor: true,
  knowledge: true,
} as const;
const SHIPPED_KEYS = Object.keys(SHIPPED_MASK);

/**
 * The config as layers: the shipped defaults (`base/defaults.config.json`), then the config of each rule pack the project
 * turned on, in the order of `packs`, then the project file. The layers are merged as plain data before the one schema parse
 * of `ConfigLoader`, so every shipped value is checked by the same schema as the project's own.
 *
 * Rules, the same for every key: an object merges key by key; an array adds (the items of the later layer after those of
 * the earlier, an item that is already there left out; for an array of objects the later copy of one identity replaces the
 * earlier in its place); a scalar is overridden by the later layer. `packages` is the one exception: written by the project
 * (even as `[]`) it is the list, not an addition. A top-level `remove` of the project takes items out of an array after all
 * layers are in, wherever they came from.
 */
export class ConfigLayers {
  /** The arrays a layer may add to and a project may remove from. */
  static removable(): string[] {
    return Object.keys(ConfigConstants.LAYERED_ARRAYS);
  }

  /** The shipped layers for `packs`: the defaults first, then each shipped pack that has config, in order. A layer that cannot be read or is not valid is named in `problems`. */
  static shipped(opts: { packs: string[] }): { layers: IConfigLayer[]; problems: string[] } {
    const layers: IConfigLayer[] = [];
    const problems: string[] = [];
    const read = (given: { name: string; load: () => unknown }): void => {
      try {
        const value = given.load();

        if (value === undefined) {
          return;
        }

        const checked = ConfigLayers.checkShipped({ name: given.name, value });

        if (checked === undefined) {
          layers.push({ name: given.name, value: RecordValue.isRecord(value) ? value : {} });
        } else {
          problems.push(checked);
        }
      } catch (error) {
        problems.push(
          `${given.name}: not readable (${error instanceof Error ? error.message : String(error)})`,
        );
      }
    };

    read({
      name: 'base',
      load: () => {
        const file = join(BASE_DIRECTORY, DEFAULTS_FILE);

        return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
      },
    });

    for (const name of opts.packs) {
      read({ name: `pack ${name}`, load: () => RulePacks.configOf({ name }) });
    }

    return { layers, problems };
  }

  /** Why a shipped layer is not valid (a key a shipped layer may not set, or a value the schema refuses), or `undefined`. */
  static checkShipped(opts: { name: string; value: unknown }): string | undefined {
    if (!RecordValue.isRecord(opts.value)) {
      return `${opts.name}: must be an object`;
    }

    const stray = Object.keys(opts.value).filter((key) => !SHIPPED_KEYS.includes(key));

    if (stray.length > 0) {
      return `${opts.name}: ${stray.join(', ')} cannot be set by shipped defaults (one of ${SHIPPED_KEYS.join(', ')})`;
    }

    const parsed = VULCAN_CONFIG_SCHEMA.pick(SHIPPED_MASK).safeParse(opts.value);

    if (parsed.success) {
      return undefined;
    }

    const issue = parsed.error.issues[0];

    return `${opts.name}: ${issue?.path.join('.') ?? ''}: ${issue?.message ?? 'not valid'}`;
  }

  /** Merges the layers in order (the last layer wins a scalar) and applies `remove`. */
  static merge(opts: { layers: IConfigLayer[]; remove?: Record<string, string[]> }): IConfigMerge {
    const from: Record<string, string> = {};
    let value: Record<string, unknown> = {};

    for (const layer of opts.layers) {
      value = ConfigLayers.mergeObject({
        into: value,
        add: layer.value,
        path: '',
        layer: layer.name,
        from,
      });
    }

    const unmatched: string[] = [];

    for (const [path, items] of Object.entries(opts.remove ?? {})) {
      const holder = ConfigLayers.holderOf({ value, path });
      const current = holder?.object[holder.key];

      if (!Array.isArray(current)) {
        unmatched.push(...items.map((item) => `${path}: ${item}`));
        continue;
      }

      const identity = ConfigConstants.LAYERED_ARRAYS[path];
      const kept = current.filter(
        (item: unknown) => !items.includes(ConfigLayers.identityOf({ item, identity })),
      );

      for (const item of items) {
        if (
          !current.some(
            (entry: unknown) => ConfigLayers.identityOf({ item: entry, identity }) === item,
          )
        ) {
          unmatched.push(`${path}: ${item}`);
        }
      }

      if (holder !== undefined) {
        holder.object[holder.key] = kept;
      }
    }

    return { value, from, unmatched };
  }

  /** The values of `project` that a layer below it already gives, by dotted path: lines the project file can delete. */
  static redundant(opts: { project: Record<string, unknown>; below: IConfigLayer[] }): string[] {
    const lower = ConfigLayers.merge({ layers: opts.below });
    const upper = ConfigLayers.merge({
      layers: [{ name: PROJECT_LAYER, value: opts.project }],
    });
    const found: string[] = [];

    for (const path of Object.keys(upper.from)) {
      if (
        path in lower.from &&
        ConfigLayers.valueAt({ value: lower.value, path }) ===
          ConfigLayers.valueAt({ value: upper.value, path })
      ) {
        found.push(path);
      }
    }

    return found;
  }

  private static identityOf(opts: {
    item: unknown;
    identity: string | string[] | undefined;
  }): string {
    if (opts.identity !== undefined && RecordValue.isRecord(opts.item)) {
      const { item } = opts;

      return [opts.identity]
        .flat()
        .map((field) => {
          const value = item[field];

          return Array.isArray(value) ? value.join(',') : value === undefined ? '' : String(value);
        })
        .join('|');
    }

    return typeof opts.item === 'string' ? opts.item : JSON.stringify(opts.item);
  }

  private static mergeObject(opts: {
    into: Record<string, unknown>;
    add: Record<string, unknown>;
    path: string;
    layer: string;
    from: Record<string, string>;
  }): Record<string, unknown> {
    const out: Record<string, unknown> = { ...opts.into };

    for (const [key, incoming] of Object.entries(opts.add)) {
      const path = opts.path === '' ? key : `${opts.path}.${key}`;
      const current = out[key];

      if (incoming === undefined) {
        continue;
      }

      if (
        RecordValue.isRecord(incoming) &&
        (current === undefined || RecordValue.isRecord(current))
      ) {
        out[key] = ConfigLayers.mergeObject({
          into: RecordValue.isRecord(current) ? current : {},
          add: incoming,
          path,
          layer: opts.layer,
          from: opts.from,
        });
      } else if (
        Array.isArray(incoming) &&
        path !== 'packages' &&
        (current === undefined || Array.isArray(current))
      ) {
        out[key] = ConfigLayers.mergeArray({
          into: Array.isArray(current) ? current : [],
          add: incoming,
          path,
          layer: opts.layer,
          from: opts.from,
        });
      } else {
        out[key] = incoming;

        if (!Array.isArray(incoming) || path === 'packages') {
          opts.from[path] = opts.layer;
        }
      }
    }

    return out;
  }

  private static mergeArray(opts: {
    into: unknown[];
    add: unknown[];
    path: string;
    layer: string;
    from: Record<string, string>;
  }): unknown[] {
    const identity = ConfigConstants.LAYERED_ARRAYS[opts.path];
    const out = [...opts.into];

    for (const item of opts.add) {
      const id = ConfigLayers.identityOf({ item, identity });
      const at = out.findIndex(
        (entry) => ConfigLayers.identityOf({ item: entry, identity }) === id,
      );

      if (at === -1) {
        out.push(item);
      } else if (identity !== undefined) {
        out[at] = item;
      }

      opts.from[`${opts.path}[${id}]`] = opts.layer;
    }

    return out;
  }

  private static holderOf(opts: {
    value: Record<string, unknown>;
    path: string;
  }): { object: Record<string, unknown>; key: string } | undefined {
    const keys = opts.path.split('.');
    const key = keys.pop() ?? '';
    let object: unknown = opts.value;

    for (const part of keys) {
      object = RecordValue.isRecord(object) ? object[part] : undefined;
    }

    return RecordValue.isRecord(object) ? { object, key } : undefined;
  }

  private static valueAt(opts: { value: Record<string, unknown>; path: string }): string {
    const bracket = /^(.*)\[(.*)\]$/.exec(opts.path);
    const holder = ConfigLayers.holderOf({ value: opts.value, path: bracket?.[1] ?? opts.path });
    const found = holder?.object[holder.key];

    return bracket === null
      ? JSON.stringify(found)
      : JSON.stringify(
          Array.isArray(found)
            ? found.find(
                (item: unknown) =>
                  ConfigLayers.identityOf({
                    item,
                    identity: ConfigConstants.LAYERED_ARRAYS[bracket[1] ?? ''],
                  }) === bracket[2],
              )
            : undefined,
        );
  }
}
