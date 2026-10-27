/**
 * Compares the shared wiki theme of this checkout (VULCAN, canonical) with the same folder of the
 * other two wikis, and fails when a copy differs, naming the files.
 *
 *   bun scripts/wiki-shared/check.ts ../ignis ../ardor     local checkouts, hashed from disk
 *   bun scripts/wiki-shared/check.ts --remote              the SHARED.json each repo publishes on develop
 *   --allow-missing                                        a wiki that has no shared folder yet is not a failure
 *
 * `--remote` is what the scheduled workflow runs. It reads a public file as data: the JSON is
 * validated before it is trusted, and only its hashes are compared.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  buildManifest,
  describeDrift,
  diffFiles,
  isInStep,
  parseManifest,
  readManifest,
  SHARED_DIR,
  MANIFEST_FILE,
  type TManifest,
} from './manifest.ts';

const CANONICAL = resolve(import.meta.dir, '..', '..');
export const REMOTES: Record<string, string> = {
  ignis: 'https://raw.githubusercontent.com/VENIZIA-AI/ignis/develop',
  ardor: 'https://raw.githubusercontent.com/VENIZIA-AI/ardor/develop',
};

export type TVerdict = { name: string; state: 'in-step' | 'drifted' | 'missing'; detail: string };

/** One wiki against the canonical manifest. `theirs` is null when it has no shared folder yet. */
export const compare = (opts: {
  name: string;
  canonical: TManifest;
  theirs: TManifest | null;
}): TVerdict => {
  if (opts.theirs === null) {
    return { name: opts.name, state: 'missing', detail: 'no shared folder yet' };
  }

  const drift = diffFiles({ expected: opts.canonical.files, actual: opts.theirs.files });

  if (isInStep({ drift }) && opts.theirs.fingerprint === opts.canonical.fingerprint) {
    return {
      name: opts.name,
      state: 'in-step',
      detail: `fingerprint ${opts.canonical.fingerprint.slice(0, 12)}`,
    };
  }

  return {
    name: opts.name,
    state: 'drifted',
    detail: isInStep({ drift })
      ? 'the fingerprint differs from its own files'
      : describeDrift({ drift }),
  };
};

const localManifest = (opts: { path: string }): TManifest | null =>
  existsSync(join(opts.path, SHARED_DIR)) ? buildManifest({ root: opts.path }) : null;

const remoteManifest = async (opts: { base: string }): Promise<TManifest | null> => {
  const response = await fetch(`${opts.base}/${SHARED_DIR}/${MANIFEST_FILE}`);

  return response.ok ? parseManifest({ text: await response.text() }) : null;
};

if (import.meta.main) {
  const allowMissing = process.argv.includes('--allow-missing');
  const remote = process.argv.includes('--remote');
  const paths = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));
  const canonical = readManifest({ root: CANONICAL }) ?? buildManifest({ root: CANONICAL });

  if (!remote && paths.length === 0) {
    console.error('check: name the checkouts to compare (../ignis ../ardor) or pass --remote');
    process.exit(1);
  }

  const verdicts: TVerdict[] = [];

  for (const path of paths) {
    verdicts.push(
      compare({ name: path, canonical, theirs: localManifest({ path: resolve(path) }) }),
    );
  }

  if (remote) {
    for (const [name, base] of Object.entries(REMOTES)) {
      verdicts.push(compare({ name, canonical, theirs: await remoteManifest({ base }) }));
    }
  }

  let failed = false;

  for (const verdict of verdicts) {
    console.log(`check: ${verdict.name}: ${verdict.state}: ${verdict.detail}`);
    failed ||= verdict.state === 'drifted' || (verdict.state === 'missing' && !allowMissing);
  }

  process.exit(failed ? 1 : 0);
}
