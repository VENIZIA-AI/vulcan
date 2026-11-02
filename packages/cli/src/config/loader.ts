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
  /** `.configs/vulcan.config.mts` when the project has one. */
  static findFile(opts: { root: string }): string | undefined {
    const file = join(opts.root, ConfigConstants.DIRECTORY, ConfigConstants.FILE);

    return existsSync(file) ? file : undefined;
  }

  static async load(opts: { root: string }): Promise<TLoadResult> {
    const file = ConfigLoader.findFile({ root: opts.root });

    if (file === undefined) {
      return {
        ok: false,
        error: `no ${ConfigConstants.DIRECTORY}/${ConfigConstants.FILE} found in ${opts.root}`,
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
