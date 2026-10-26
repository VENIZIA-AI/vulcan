/**
 * Copies the canonical shared wiki theme of this checkout (VULCAN) into the checkout of another
 * wiki, byte for byte, and removes files of it that are no longer shared. The target repository's
 * agent runs it in its own checkout and commits the result there; nothing here writes to a
 * repository its caller did not name.
 *
 *   bun ../vulcan/scripts/wiki-shared/copy.ts . --dry-run    list what would change, write nothing
 *   bun ../vulcan/scripts/wiki-shared/copy.ts .              copy
 */
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  buildManifest,
  fingerprintOf,
  MANIFEST_FILE,
  readManifest,
  renderManifest,
  SHARED_DIR,
} from './manifest.ts';

const CANONICAL = resolve(import.meta.dir, '..', '..');

type TAction = { kind: 'new' | 'changed' | 'removed'; path: string };

/** What copying would do to `target`, and the canonical manifest it would leave there. */
export const planCopy = (opts: { source: string; target: string }): TAction[] => {
  const manifest = buildManifest({ root: opts.source });
  const targetDir = join(opts.target, SHARED_DIR);
  const have = existsSync(targetDir) ? buildManifest({ root: opts.target }).files : {};
  const actions: TAction[] = [];

  for (const [path, hash] of Object.entries(manifest.files)) {
    if (!(path in have)) {
      actions.push({ kind: 'new', path });
    } else if (have[path] !== hash) {
      actions.push({ kind: 'changed', path });
    }
  }

  for (const path of Object.keys(have)) {
    if (!(path in manifest.files)) {
      actions.push({ kind: 'removed', path });
    }
  }

  const theirs = readManifest({ root: opts.target });

  if (theirs?.fingerprint !== manifest.fingerprint && actions.length === 0) {
    actions.push({ kind: 'changed', path: MANIFEST_FILE });
  }

  return actions;
};

export const applyCopy = (opts: { source: string; target: string }): TAction[] => {
  const actions = planCopy(opts);
  const sourceDir = join(opts.source, SHARED_DIR);
  const targetDir = join(opts.target, SHARED_DIR);

  for (const action of actions) {
    if (action.path === MANIFEST_FILE) {
      continue;
    }

    const file = join(targetDir, action.path);

    if (action.kind === 'removed') {
      rmSync(file);
    } else {
      mkdirSync(dirname(file), { recursive: true });
      copyFileSync(join(sourceDir, action.path), file);
    }
  }

  mkdirSync(targetDir, { recursive: true });

  const manifest = buildManifest({ root: opts.source });

  writeFileSync(join(targetDir, MANIFEST_FILE), renderManifest({ manifest }));

  return actions;
};

if (import.meta.main) {
  const dryRun = process.argv.includes('--dry-run');
  const targets = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));

  if (targets.length === 0) {
    console.error(
      'copy: name the checkout to copy into, e.g. bun ../vulcan/scripts/wiki-shared/copy.ts .',
    );
    process.exit(1);
  }

  // The canonical manifest must describe the canonical files, or the copy would spread a stale one.
  const committed = readManifest({ root: CANONICAL });
  const actual = buildManifest({ root: CANONICAL });

  if (committed === null || committed.fingerprint !== fingerprintOf({ files: actual.files })) {
    console.error(
      'copy: SHARED.json of the canonical checkout is out of date; run manifest.ts there first',
    );
    process.exit(1);
  }

  for (const name of targets) {
    const target = resolve(name);

    if (!existsSync(join(target, 'docs', 'wiki', 'site', '.vitepress'))) {
      console.error(
        `copy: ${target} has no docs/wiki/site/.vitepress; name the root of a wiki checkout`,
      );
      process.exit(1);
    }

    if (target === CANONICAL) {
      console.error('copy: the target is the canonical checkout itself');
      process.exit(1);
    }

    const actions = dryRun
      ? planCopy({ source: CANONICAL, target })
      : applyCopy({ source: CANONICAL, target });

    for (const action of actions) {
      console.log(`${dryRun ? 'would be ' : ''}${action.kind}: ${action.path}`);
    }

    console.log(
      `copy: ${target}: ${actions.length === 0 ? 'already in step' : `${actions.length} file(s) ${dryRun ? 'differ' : 'written or removed'}`}`,
    );
  }
}
