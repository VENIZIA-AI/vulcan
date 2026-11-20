import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { HookConstants } from '../hooks/common/index.ts';
import { HooksBundle } from '../sync/hooks-bundle.ts';

/** The folder of the hook bundle a test copies from: the one the package ships, or the one built from the sources once for the run. */
const bundleFolder = (): string => {
  const source = HooksBundle.source();

  if (source === undefined) {
    throw new Error('no hook bundle: run make hooks-bundle');
  }

  return source.folder;
};

/**
 * What `vulcan sync` does for the hooks: the real bundle copied into `<root>/.agents/local/hooks/`. `except` leaves some files out.
 */
export const installBundle = (opts: { root: string; except?: string[] }): string => {
  const target = join(opts.root, HookConstants.BUNDLE_DIRECTORY);

  mkdirSync(target, { recursive: true });

  for (const file of readdirSync(bundleFolder()).filter((name) => name.endsWith('.js'))) {
    if (!(opts.except ?? []).includes(file)) {
      copyFileSync(join(bundleFolder(), file), join(target, file));
    }
  }

  return target;
};
