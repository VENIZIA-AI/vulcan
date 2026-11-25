import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ConfigConstants } from './common/index.ts';
import { VULCAN_CONFIG_SCHEMA } from './schema.ts';
import type { TResolvedConfig } from './schema.ts';
import { ProjectLayout } from '../common/constants.ts';
import { RecordValue } from '../common/record.ts';
import { ConfigLayers } from './layers.ts';
import { WorkspacePackages } from './workspaces.ts';
import { ConfigGroups } from './groups.ts';
import type { IConfigLayer, IConfigMerge, IShippedProblem } from './layers.ts';

type TLoadResult =
  | {
      ok: true;
      file: string;
      config: TResolvedConfig;
      /** The project's own object, the layers below it and the merge the config was parsed from: what `vulcan config` shows. */
      layers: {
        project: Record<string, unknown>;
        below: IConfigLayer[];
        merge: IConfigMerge;
      };
    }
  | { ok: false; file?: string; error: string };

const describeError = (opts: { error: unknown }): string =>
  opts.error instanceof Error ? opts.error.message : String(opts.error);

/** Finds and loads the project `vulcan.config.*` file and reports an unreadable one; used by `vulcan project sync`, `vulcan project doctor` and the session hooks. */
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

    // A flat config is an OLDER one: the way out is the codemod, not an upgrade.
    if (head.includes('the config is in the flat shape')) {
      return `the project config is in the flat shape of the earlier releases, so its values are ignored and the defaults apply. Run \`${ProjectLayout.VULCAN_COMMAND} config codemod config-groups . --write\` to move it into the seven groups (\`--split\` writes one file per group)`;
    }

    const problem =
      head.endsWith('invalid config') && first.trim() !== '' ? first.trim() : head.trim();

    return `the project config could not be read by this VULCAN, so its defaults apply (${problem}). Run \`vulcan project doctor\`; a config newer than this VULCAN needs \`vulcan project upgrade\``;
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

  /**
   * The config of a project, validated. The flat shape of the earlier releases is refused with the new path of each key, except
   * for a caller that passes `isLenient`: the migration tool, which has to read the old shape to move it. Adding a caller that does
   * is a decision (`loader.test.ts` pins the list).
   */
  static async load(opts: { root: string; isLenient?: boolean }): Promise<TLoadResult> {
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

    // The file is written in groups or flat; the rest of the load reads the flat one.
    let written: unknown = loaded.default;

    // A key that moved is the flat shape of the earlier releases and is refused with its new path; a key that is no config key at all
    // (a typo) is left to the schema, which names it as it always has.
    const flat =
      opts.isLenient !== true &&
      RecordValue.isRecord(written) &&
      ConfigGroups.isFlat({ value: written })
        ? ConfigGroups.movesOf({ value: written })
        : undefined;

    if (flat !== undefined && flat.moved.length > 0) {
      return {
        ok: false,
        file,
        error: [
          `${shown}: the config is in the flat shape of the earlier releases; its keys are in seven groups now (project, agent, guard, board, knowledge, check, common)`,
          ...flat.moved.map((move) => `  ${move.key}: moved to ${move.to}`),
          ...flat.unknown.map((key) => `  ${key}: not a config key`),
          `run \`${ProjectLayout.VULCAN_COMMAND} config codemod config-groups . --write\` (or \`${ProjectLayout.VULCAN_COMMAND} migrate apply\`), which rewrites the file with its values and comments (\`--split\` writes one file per group)`,
        ].join('\n'),
      };
    }

    // The file is written in groups or flat (a flat file with only a typo is read as it was: the schema names the key).
    if (RecordValue.isRecord(written) && !ConfigGroups.isFlat({ value: written })) {
      const grouped = ConfigGroups.toFlat({ value: written });

      if (grouped.issues.length > 0) {
        return {
          ok: false,
          file,
          error: `${shown}: invalid config\n${grouped.issues.map((issue) => `  ${issue}`).join('\n')}`,
        };
      }

      written = grouped.flat;
    }

    const layered = ConfigLoader.layered({ project: written });

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
      RecordValue.isRecord(written) ? layered.merge.value : written,
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

    // Packages the config does not write (or writes as `undefined`, as a split config does) are the workspace members of the root; a list the project writes, even `[]`, is the list.
    const isDerived = RecordValue.isRecord(written) && written['packages'] === undefined;

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
        project: RecordValue.isRecord(written) ? written : {},
        below: layered.below,
        merge: layered.merge,
      },
    };
  }
}
