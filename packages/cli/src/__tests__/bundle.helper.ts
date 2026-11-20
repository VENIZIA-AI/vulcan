import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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

const git = (opts: { root: string; args: string[] }): void => {
  const result = Bun.spawnSync(
    [
      'git',
      '-c',
      'user.email=t@t.t',
      '-c',
      'user.name=t',
      '-c',
      'commit.gpgsign=false',
      ...opts.args,
    ],
    { cwd: opts.root },
  );

  if (result.exitCode !== 0) {
    throw new Error(`git ${opts.args.join(' ')}: ${result.stderr.toString()}`);
  }
};

/** The manifest the project has, or `opts.manifest`, as an object: what a test writes may be broken on purpose, and then it starts from nothing. */
const manifestOf = (opts: {
  root: string;
  manifest: string | undefined;
}): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(
      opts.manifest ?? readFileSync(join(opts.root, '.agents', 'vulcan.manifest.json'), 'utf8'),
    );

    return typeof parsed === 'object' && parsed !== null
      ? Object.fromEntries(Object.entries(parsed))
      : {};
  } catch {
    return {};
  }
};

/**
 * What `vulcan sync` and the owner's commit do for the hooks: the real bundle copied into `<root>/.agents/local/hooks/`, its sums
 * recorded in the manifest, and the manifest committed in a git repository of its own, because every hook runs only the bundle that the
 * manifest at HEAD records. `except` leaves files out, `files` puts a script of the test in place of one (a hook that crashes) before
 * its sum is recorded, and `manifest` is the project's manifest text: it is committed with the hooks block, and left in the working tree
 * as given, so a test can have a manifest that cannot be read there while HEAD holds a good one.
 */
export const installBundle = (opts: {
  root: string;
  except?: string[];
  files?: Record<string, string>;
  manifest?: string;
  /** Copy none of the real bundle: only `files`. */
  bare?: boolean;
}): string => {
  const target = join(opts.root, HookConstants.BUNDLE_DIRECTORY);

  mkdirSync(target, { recursive: true });

  for (const file of readdirSync(bundleFolder()).filter((name) => name.endsWith('.js'))) {
    if (opts.bare !== true && !(opts.except ?? []).includes(file)) {
      copyFileSync(join(bundleFolder(), file), join(target, file));
    }
  }

  for (const [name, text] of Object.entries(opts.files ?? {})) {
    writeFileSync(join(target, name), text);
  }

  const sums = Object.fromEntries(
    readdirSync(target)
      .filter((name) => name.endsWith('.js'))
      .map((name) => [name, HooksBundle.sha256({ bytes: readFileSync(join(target, name)) })]),
  );
  const committed = `${JSON.stringify(
    {
      ...manifestOf({ root: opts.root, manifest: opts.manifest }),
      hooks: { version: 'test', folder: HookConstants.BUNDLE_DIRECTORY, sha256: sums },
    },
    null,
    2,
  )}\n`;

  mkdirSync(join(opts.root, '.agents'), { recursive: true });
  writeFileSync(join(opts.root, '.agents', 'vulcan.manifest.json'), committed);
  git({ root: opts.root, args: ['init', '-q', '-b', 'main'] });
  git({ root: opts.root, args: ['add', '.agents/vulcan.manifest.json'] });
  git({ root: opts.root, args: ['commit', '-q', '-m', 'manifest'] });

  if (opts.manifest !== undefined) {
    writeFileSync(join(opts.root, '.agents', 'vulcan.manifest.json'), opts.manifest);
  }

  return target;
};
