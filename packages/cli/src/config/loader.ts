import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ConfigConstants, ConfigExtensions } from './common/index.ts';
import { VULCAN_CONFIG_SCHEMA } from './schema.ts';
import type { TResolvedConfig } from './schema.ts';

export type TLoadResult =
  | { ok: true; file: string; config: TResolvedConfig }
  | { ok: false; file?: string; error: string };

const describeError = (opts: { error: unknown }): string =>
  opts.error instanceof Error ? opts.error.message : String(opts.error);

/** Every `.configs/vulcan.config.<ext>` present, in lookup order. */
export const findConfigFiles = (opts: { root: string }): string[] =>
  ConfigExtensions.LOOKUP_ORDER.map((extension) =>
    join(opts.root, ConfigConstants.DIRECTORY, `${ConfigConstants.BASENAME}.${extension}`),
  ).filter((file) => existsSync(file));

export const loadConfig = async (opts: { root: string }): Promise<TLoadResult> => {
  const files = findConfigFiles({ root: opts.root });

  if (files.length === 0) {
    return {
      ok: false,
      error: `no ${ConfigConstants.DIRECTORY}/${ConfigConstants.BASENAME}.* found in ${opts.root}`,
    };
  }

  if (files.length > 1) {
    const names = files.map((file) => relative(opts.root, file)).join(', ');

    return { ok: false, error: `more than one config - keep exactly one of: ${names}` };
  }

  const [file] = files;
  const shown = relative(opts.root, file);

  let loaded: { default?: unknown };

  try {
    loaded = await import(pathToFileURL(file).href);
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
};
