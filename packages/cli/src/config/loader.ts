import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ConfigConstants } from './common/index.ts';
import { VULCAN_CONFIG_SCHEMA } from './schema.ts';
import type { TResolvedConfig } from './schema.ts';

type TLoadResult =
  | { ok: true; file: string; config: TResolvedConfig }
  | { ok: false; file?: string; error: string };

const describeError = (opts: { error: unknown }): string =>
  opts.error instanceof Error ? opts.error.message : String(opts.error);

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
    const problem =
      head.endsWith('invalid config') && first.trim() !== '' ? first.trim() : head.trim();

    return `the project config could not be read by this VULCAN, so its defaults apply (${problem}). Run \`vulcan doctor\`; a config newer than this VULCAN needs \`vulcan upgrade\``;
  }

  /** `.configs/vulcan.config.mts` when the project has one. */
  static findFile(opts: { root: string }): string | undefined {
    const file = join(opts.root, ConfigConstants.DIRECTORY, ConfigConstants.FILE);

    return existsSync(file) ? file : undefined;
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

    const parsed = VULCAN_CONFIG_SCHEMA.safeParse(loaded.default);

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

    return { ok: true, file, config: parsed.data };
  }
}
