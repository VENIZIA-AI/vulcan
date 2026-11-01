/**
 * Compares the shared wiki theme of this checkout (VULCAN, canonical) with the same folder of the
 * other two wikis, and fails when a copy differs, naming the files.
 *
 *   bun scripts/wiki-shared/check.ts ../ignis ../ardor     local checkouts, hashed from disk
 *   bun scripts/wiki-shared/check.ts --remote              the SHARED.json each repo publishes on develop
 *
 * `--remote` is what the scheduled workflow runs. It reads a public file as data: the JSON is
 * validated before it is trusted, and only its hashes are compared.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SharedManifest, SHARED_DIR, MANIFEST_FILE, type TManifest } from './manifest.ts';

const CANONICAL = resolve(import.meta.dir, '..', '..');
const REMOTES: Record<string, string> = {
  ignis: 'https://raw.githubusercontent.com/VENIZIA-AI/ignis/develop',
  ardor: 'https://raw.githubusercontent.com/VENIZIA-AI/ardor/develop',
};

type TVerdict = { name: string; state: 'in-step' | 'drifted' | 'missing'; detail: string };

/** A fetch that answered with a status that is not ok: what the verdict says when it is not a 404. */
type TFetchFailure = { status: number; url: string };

export class SharedCheck {
  /**
   * One wiki against the canonical manifest. `theirs` is null when it could not be read: with no
   * shared folder yet (a 404, or a checkout without the folder), or, when `failure` says so, because
   * the fetch answered with another status (a rate limit, a server error), which the detail names.
   */
  static compare(opts: {
    name: string;
    canonical: TManifest;
    theirs: TManifest | null;
    failure?: TFetchFailure;
  }): TVerdict {
    if (opts.theirs === null) {
      const detail =
        opts.failure !== undefined && opts.failure.status !== 404
          ? `HTTP ${opts.failure.status} from ${opts.failure.url}`
          : 'no shared folder yet';

      return { name: opts.name, state: 'missing', detail };
    }

    const drift = SharedManifest.diffFiles({
      expected: opts.canonical.files,
      actual: opts.theirs.files,
    });

    if (
      SharedManifest.isInStep({ drift }) &&
      opts.theirs.fingerprint === opts.canonical.fingerprint
    ) {
      return {
        name: opts.name,
        state: 'in-step',
        detail: `fingerprint ${opts.canonical.fingerprint.slice(0, 12)}`,
      };
    }

    return {
      name: opts.name,
      state: 'drifted',
      detail: SharedManifest.isInStep({ drift })
        ? 'the fingerprint differs from its own files'
        : SharedManifest.describeDrift({ drift }),
    };
  }
}

const localManifest = (opts: { path: string }): TManifest | null =>
  existsSync(join(opts.path, SHARED_DIR)) ? SharedManifest.build({ root: opts.path }) : null;

const remoteManifest = async (opts: {
  base: string;
}): Promise<{ manifest: TManifest | null; failure?: TFetchFailure }> => {
  const url = `${opts.base}/${SHARED_DIR}/${MANIFEST_FILE}`;
  const response = await fetch(url);

  if (!response.ok) {
    return { manifest: null, failure: { status: response.status, url } };
  }

  return { manifest: SharedManifest.parse({ text: await response.text() }) };
};

if (import.meta.main) {
  const remote = process.argv.includes('--remote');
  const paths = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));
  const canonical =
    SharedManifest.read({ root: CANONICAL }) ?? SharedManifest.build({ root: CANONICAL });

  if (!remote && paths.length === 0) {
    console.error('check: name the checkouts to compare (../ignis ../ardor) or pass --remote');
    process.exit(1);
  }

  const verdicts: TVerdict[] = [];

  for (const path of paths) {
    verdicts.push(
      SharedCheck.compare({
        name: path,
        canonical,
        theirs: localManifest({ path: resolve(path) }),
      }),
    );
  }

  if (remote) {
    for (const [name, base] of Object.entries(REMOTES)) {
      const { manifest, failure } = await remoteManifest({ base });

      verdicts.push(SharedCheck.compare({ name, canonical, theirs: manifest, failure }));
    }
  }

  let failed = false;

  for (const verdict of verdicts) {
    console.log(`check: ${verdict.name}: ${verdict.state}: ${verdict.detail}`);
    failed ||= verdict.state !== 'in-step';
  }

  process.exit(failed ? 1 : 0);
}
