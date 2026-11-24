import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_DIRECTORY } from '../common/paths.ts';
import { RecordValue } from '../common/record.ts';
import { RulePacks } from '../rules/packs.ts';
import { ConfigConstants } from './common/index.ts';
import { ConfigGroups } from './groups.ts';
import { VULCAN_CONFIG_SCHEMA } from './schema.ts';

/** One layer of the config: the shipped defaults, a pack's config, or the project's own file. */
export interface IConfigLayer {
  name: string;
  value: Record<string, unknown>;
}

/** A shipped layer that is not valid: the file it came from, and why. */
export interface IShippedProblem {
  file: string;
  message: string;
}

/** What a merge gives back: the merged object, where each value came from, and the `remove` entries that matched nothing. */
export interface IConfigMerge {
  value: Record<string, unknown>;
  /** The last layer that set each scalar (`digest.x`) and each array item (`presets[<spec>]`), by dotted path. */
  from: Record<string, string>;
  unmatched: string[];
}

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

/** Whether a value is a plain object: a literal or `JSON.parse`, never a `Date`, a class instance or an array. */
const isPlain = (value: unknown): value is Record<string, unknown> => {
  if (!RecordValue.isRecord(value)) {
    return false;
  }

  const prototype: unknown = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
};

/** A key set as an own property, so a key named `__proto__` stays a key (which the strict schema refuses) and never changes a prototype. */
const define = (opts: { into: Record<string, unknown>; key: string; value: unknown }): void => {
  Object.defineProperty(opts.into, opts.key, {
    value: opts.value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
};

/**
 * The config as layers: the shipped defaults (`base/defaults.config.json`), then the config of each rule pack the project
 * turned on, in the order of `packs`, then the project file. The layers are merged as plain data before the one schema parse
 * of `ConfigLoader`, so every shipped value is checked by the same schema as the project's own.
 *
 * Rules: an object merges key by key; a scalar, and every array that is not listed in `ConfigConstants.LAYERED_ARRAYS`, is
 * replaced by the later layer. The six listed arrays add: the items of a later layer come after those of the earlier layers,
 * an item the earlier layers already hold is not added again (a string) or replaces it in its place (an object of the same
 * identity). Items are compared with the earlier layers only, never with each other, so a layer that lists an item twice
 * keeps both, as the schema alone would. A top-level `remove` of the project takes items out of a listed array after all
 * layers are in, wherever they came from.
 */
export class ConfigLayers {
  /**
   * The shipped layers for `packs`: the defaults first, then each shipped pack that has config, in order. A layer that cannot
   * be read or is not valid is named, with its file, in `problems`.
   */
  static shipped(opts: { packs: string[] }): {
    layers: IConfigLayer[];
    problems: IShippedProblem[];
  } {
    const layers: IConfigLayer[] = [];
    const problems: IShippedProblem[] = [];
    const read = (given: { name: string; file: string; load: () => unknown }): void => {
      try {
        const value = given.load();
        const message = ConfigLayers.checkShipped({ value });

        // A shipped file is written in groups, like a project's; the layers are merged flat, as the schema reads them.
        if (message === undefined) {
          layers.push({
            name: given.name,
            value: isPlain(value) ? ConfigGroups.toFlat({ value }).flat : {},
          });
        } else {
          problems.push({ file: given.file, message });
        }
      } catch (error) {
        problems.push({
          file: given.file,
          message: `not readable (${error instanceof Error ? error.message : String(error)})`,
        });
      }
    };

    if (existsSync(join(BASE_DIRECTORY, DEFAULTS_FILE))) {
      read({
        name: 'base',
        file: `base/${DEFAULTS_FILE}`,
        load: () => JSON.parse(readFileSync(join(BASE_DIRECTORY, DEFAULTS_FILE), 'utf8')),
      });
    }

    for (const name of opts.packs) {
      const config = RulePacks.configOf({ name });

      if (config.found) {
        read({
          name: `pack ${name}`,
          file: `base/packs/${name}.config.json`,
          load: () => config.value,
        });
      }
    }

    return { layers, problems };
  }

  /** Why a shipped layer is not valid (a key a shipped layer may not set, or a value the schema refuses), or `undefined`. */
  static checkShipped(opts: { value: unknown }): string | undefined {
    if (!isPlain(opts.value)) {
      return 'must be an object';
    }

    const stray = ConfigGroups.strayOfShipped({ value: opts.value });

    if (stray.length > 0) {
      return `${stray.join(', ')} cannot be set by shipped defaults (a project's own facts are not defaults)`;
    }

    const { flat, issues } = ConfigGroups.toFlat({ value: opts.value });

    if (issues.length > 0) {
      return issues[0];
    }

    const parsed = VULCAN_CONFIG_SCHEMA.pick(SHIPPED_MASK).safeParse(flat);

    if (parsed.success) {
      return undefined;
    }

    const issue = parsed.error.issues[0];

    return `${ConfigGroups.groupedPathOf({ path: issue?.path.join('.') ?? '' })}: ${issue?.message ?? 'not valid'}`;
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
      const identity = ConfigConstants.LAYERED_ARRAYS[path];
      const holder = ConfigLayers.holderOf({ value, path });
      const current = holder?.object[holder.key];

      if (holder === undefined || !Array.isArray(current)) {
        unmatched.push(...items.map((item) => `${path}: ${item}`));
        continue;
      }

      const names = current.map((entry: unknown) =>
        ConfigLayers.identityOf({ item: entry, identity }),
      );

      unmatched.push(
        ...items.filter((item) => !names.includes(item)).map((item) => `${path}: ${item}`),
      );
      define({
        into: holder.object,
        key: holder.key,
        value: current.filter((_, at) => !items.includes(names[at] ?? '')),
      });
    }

    return { value, from, unmatched };
  }

  /** The values of `project` that a layer below it already gives, by dotted path: lines the project file can delete. */
  static redundant(opts: { project: Record<string, unknown>; below: IConfigLayer[] }): string[] {
    const lower = ConfigLayers.merge({ layers: opts.below });
    const upper = ConfigLayers.merge({ layers: [{ name: 'project', value: opts.project }] });

    return Object.keys(upper.from).filter(
      (path) =>
        path in lower.from &&
        ConfigLayers.valueAt({ value: lower.value, path }) ===
          ConfigLayers.valueAt({ value: upper.value, path }),
    );
  }

  /** The name of an item: itself for a string, else its identity fields joined by `|` (the `kinds` of an acknowledgement sorted, joined by `,`). */
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

          return Array.isArray(value)
            ? value.map(String).sort().join(',')
            : value === undefined
              ? ''
              : String(value);
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
      const current = Object.hasOwn(out, key) ? out[key] : undefined;

      if (incoming === undefined) {
        continue;
      }

      if (isPlain(incoming) && (current === undefined || isPlain(current))) {
        define({
          into: out,
          key,
          value: ConfigLayers.mergeObject({
            into: isPlain(current) ? current : {},
            add: incoming,
            path,
            layer: opts.layer,
            from: opts.from,
          }),
        });
      } else if (
        Array.isArray(incoming) &&
        Object.hasOwn(ConfigConstants.LAYERED_ARRAYS, path) &&
        (current === undefined || Array.isArray(current))
      ) {
        define({
          into: out,
          key,
          value: ConfigLayers.mergeArray({
            into: Array.isArray(current) ? current : [],
            add: incoming,
            path,
            layer: opts.layer,
            from: opts.from,
          }),
        });
      } else {
        define({ into: out, key, value: incoming });
        opts.from[path] = opts.layer;
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
    const earlier = opts.into.map((entry) => ConfigLayers.identityOf({ item: entry, identity }));
    const met = new Set<number>();

    for (const item of opts.add) {
      const id = ConfigLayers.identityOf({ item, identity });
      const at = earlier.indexOf(id);

      // Only the earlier layers' items are met, once each: a second copy in this layer is its own item.
      if (at === -1 || met.has(at)) {
        out.push(item);
      } else {
        met.add(at);

        if (identity !== undefined) {
          out[at] = item;
        }
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
      object = isPlain(object) && Object.hasOwn(object, part) ? object[part] : undefined;
    }

    return isPlain(object) ? { object, key } : undefined;
  }

  private static valueAt(opts: { value: Record<string, unknown>; path: string }): string {
    const bracket = /^(.*)\[(.*)\]$/.exec(opts.path);
    const holder = ConfigLayers.holderOf({ value: opts.value, path: bracket?.[1] ?? opts.path });
    const found =
      holder === undefined || !Object.hasOwn(holder.object, holder.key)
        ? undefined
        : holder.object[holder.key];

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
