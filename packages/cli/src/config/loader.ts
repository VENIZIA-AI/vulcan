import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ConfigConstants } from './common/index.ts';
import { VULCAN_CONFIG_SCHEMA } from './schema.ts';
import type { TResolvedConfig } from './schema.ts';
import { RecordValue } from '../common/record.ts';
import { ConfigLayers } from './layers.ts';
import { WorkspacePackages } from './workspaces.ts';
import type { IConfigLayer, IConfigMerge, IShippedProblem } from './layers.ts';

type TLoadResult =
  | {
      ok: true;
      file: string;
      config: TResolvedConfig;
      /** The project's own object, the layers below it and the merge the config was parsed from: what `vulcan config` shows. */
      layers: { project: Record<string, unknown>; below: IConfigLayer[]; merge: IConfigMerge };
    }
  | { ok: false; file?: string; error: string };

const describeError = (opts: { error: unknown }): string =>
  opts.error instanceof Error ? opts.error.message : String(opts.error);

/** Finds and loads the project `vulcan.config.*` file and reports an unreadable one; used by `vulcan sync`, `vulcan doctor` and the session hooks. */
export class ConfigLoader {
  /**
   * What a hook says when the project has a config this VULCAN could not read (a key from a newer release, a
   * failed import) and it falls back to defaults: the first problem and the way out. `undefined` when the config
   * was read, or when the project has none (nothing was ignored).
   */
  static unreadableNote(opts: { loaded: TLoadResult }): string | undefined {
    const { loaded } = opts;

    if (loaded.ok || loaded.file === undefined) {
      return undefined;
    }

    // A schema error is "<file>: invalid config" and then one line per issue: the first issue says more than the
    // head. Any other failure (an import that threw, no default export) is told by its head line, whatever follows.
    const [head = '', first = ''] = loaded.error.split('\n');

    // The shipped config of this install is not the project's file: reinstalling the package is the way out, not an upgrade.
    if (head.endsWith('invalid shipped config')) {
      return `a config file of this VULCAN install is not valid, so the defaults apply (${head.trim()}: ${first.trim()}). Run \`bun install\` again; if it stays, report it`;
    }

    const problem =
      head.endsWith('invalid config') && first.trim() !== '' ? first.trim() : head.trim();

    return `the project config could not be read by this VULCAN, so its defaults apply (${problem}). Run \`vulcan doctor\`; a config newer than this VULCAN needs \`vulcan upgrade\``;
  }

  /** `.configs/vulcan.config.mts` when the project has one. */
  static findFile(opts: { root: string }): string | undefined {
    const file = join(opts.root, ConfigConstants.DIRECTORY, ConfigConstants.FILE);

    return existsSync(file) ? file : undefined;
  }

  /**
   * The project's config object merged over the shipped layers (the defaults, then each pack it turns on): what the schema
   * is given. A `remove` key that does not name a listed array is left out here, and the schema refuses it.
   */
  static layered(opts: { project: unknown }): {
    merge: IConfigMerge;
    below: IConfigLayer[];
    problems: IShippedProblem[];
  } {
    const project = RecordValue.isRecord(opts.project) ? opts.project : {};
    const packs = Array.isArray(project.packs)
      ? project.packs.filter((name: unknown): name is string => typeof name === 'string')
      : [];
    const shipped = ConfigLayers.shipped({ packs });
    const remove = RecordValue.isRecord(project.remove)
      ? Object.fromEntries(
          Object.entries(project.remove).flatMap(([key, items]) =>
            Object.hasOwn(ConfigConstants.LAYERED_ARRAYS, key) && Array.isArray(items)
              ? [[key, items.filter((item: unknown): item is string => typeof item === 'string')]]
              : [],
          ),
        )
      : undefined;

    return {
      merge: ConfigLayers.merge({
        layers: [...shipped.layers, { name: 'project', value: project }],
        ...(remove === undefined ? {} : { remove }),
      }),
      below: shipped.layers,
      problems: shipped.problems,
    };
  }

  static async load(opts: { root: string }): Promise<TLoadResult> {
    const file = ConfigLoader.findFile({ root: opts.root });

    if (file === undefined) {
      const other = ['ts', 'mjs', 'js']
        .map((extension) => `vulcan.config.${extension}`)
        .find((name) => existsSync(join(opts.root, ConfigConstants.DIRECTORY, name)));
      const hint =
        other === undefined ? '' : ` (${other} is not read: rename it to ${ConfigConstants.FILE})`;

      return {
        ok: false,
        error: `no ${ConfigConstants.DIRECTORY}/${ConfigConstants.FILE} found in ${opts.root}${hint}`,
      };
    }

    const shown = relative(opts.root, file);

    let loaded: { default?: unknown };

    try {
      const imported = await import(pathToFileURL(file).href);

      loaded = imported;
    } catch (error) {
      return { ok: false, file, error: `${shown}: failed to load - ${describeError({ error })}` };
    }

    if (loaded.default === undefined) {
      return {
        ok: false,
        file,
        error: `${shown}: no default export - write 'export default { ... }'`,
      };
    }

    const layered = ConfigLoader.layered({ project: loaded.default });

    // A shipped layer that is not valid is named by its own file, with the real problem: it is not the project's file.
    const broken = layered.problems[0];

    if (broken !== undefined) {
      return {
        ok: false,
        file,
        error: `${broken.file}: invalid shipped config\n  ${broken.message}`,
      };
    }

    // Only an object is layered; anything else goes to the schema as it is, which says what is wrong with it.
    const parsed = VULCAN_CONFIG_SCHEMA.safeParse(
      RecordValue.isRecord(loaded.default) ? layered.merge.value : loaded.default,
    );

    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => {
          const path =
            issue.code === 'unrecognized_keys'
              ? issue.keys.join(', ')
              : issue.path.join('.') || '(root)';

          return `  ${path}: ${issue.message}`;
        })
        .join('\n');

      return { ok: false, file, error: `${shown}: invalid config\n${issues}` };
    }

    // Packages the config does not write are the workspace members of the root; a list the project writes, even `[]`, is the list.
    const isDerived =
      RecordValue.isRecord(loaded.default) && !Object.hasOwn(loaded.default, 'packages');

    const derived = isDerived ? WorkspacePackages.derive({ root: opts.root }) : undefined;

    if (derived !== undefined && derived.errors.length > 0) {
      return {
        ok: false,
        file,
        error: `${shown}: invalid workspaces\n${derived.errors.map((error) => `  ${error}`).join('\n')}`,
      };
    }

    if (isDerived) {
      layered.merge.from.packages = 'workspaces';
    }

    return {
      ok: true,
      file,
      config: derived === undefined ? parsed.data : { ...parsed.data, packages: derived.packages },
      layers: {
        project: RecordValue.isRecord(loaded.default) ? loaded.default : {},
        below: layered.below,
        merge: layered.merge,
      },
    };
  }
}
