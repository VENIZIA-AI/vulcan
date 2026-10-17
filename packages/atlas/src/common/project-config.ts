import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** The same lookup order `vulcan` uses; a project has exactly one of them. */
const CONFIG_FILES = [
  'vulcan.config.ts',
  'vulcan.config.mts',
  'vulcan.config.mjs',
  'vulcan.config.js',
];

const isRecord = (opts: { value: unknown }): opts is { value: Record<string, unknown> } =>
  typeof opts.value === 'object' && opts.value !== null && !Array.isArray(opts.value);

/**
 * The package directories the generators read: the keys of `atlas.packages` in the project's
 * `.configs/vulcan.config.*`, in the order given - release order. Required: the generators carry no
 * project's package names of their own.
 */
export const readAtlasPackages = (opts: { repoRoot: string }): string[] => {
  const file = CONFIG_FILES.map(name => join(opts.repoRoot, '.configs', name)).find(path =>
    existsSync(path),
  );

  if (file === undefined) {
    throw new Error(`[atlas] no .configs/vulcan.config.* in ${opts.repoRoot}`);
  }

  // Bun loads a TS or ESM config synchronously through require; atlas is Bun-only.
  const loaded = { value: require(file) };
  const config = {
    value: isRecord(loaded) && 'default' in loaded.value ? loaded.value.default : loaded.value,
  };
  const atlas = { value: isRecord(config) ? config.value.atlas : undefined };
  const packages = { value: isRecord(atlas) ? atlas.value.packages : undefined };

  if (!isRecord(packages) || Object.keys(packages.value).length === 0) {
    throw new Error(
      '[atlas] add atlas.packages to .configs/vulcan.config.ts - the package directories under packages/, in release order',
    );
  }

  return Object.keys(packages.value);
};
