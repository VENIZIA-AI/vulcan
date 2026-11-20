import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  realpathSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { BASE_DIRECTORY } from '../common/index.ts';
import { HookConstants } from '../hooks/common/index.ts';
import { SyncStatuses } from './common/index.ts';
import type { ISyncAction } from './common/index.ts';

/** What the package ships and the manifest records: the version, and the sha256 of every bundle file. */
export interface IHooksBundle {
  version: string;
  files: Record<string, string>;
}

const SUMS_FILE = 'SHA256SUMS.json';
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The hooks, built into one self-contained file each and copied into the project by `vulcan sync`, so no package folder decides what a hook runs. */
export class HooksBundle {
  /** The folder of the package that holds the built files: `base/bundle`, made by the release (`make build` in a workspace). */
  static readonly SOURCE = join(BASE_DIRECTORY, 'bundle');
  /** Built once per process when the package ships none (a workspace that has not run `make build`). */
  private static built: { folder: string; sums: IHooksBundle } | undefined;

  /**
   * Whether this package is a copy installed under `node_modules` (a registry version never changes its bytes) and not the source tree of a
   * workspace, whose hooks change with its sources and whose committed manifest is checked against a fresh build by CI instead.
   */
  static isInstalled(): boolean {
    try {
      return realpathSync(BASE_DIRECTORY).includes('/node_modules/');
    } catch {
      return false;
    }
  }

  static sha256(opts: { bytes: Uint8Array }): string {
    return new Bun.CryptoHasher('sha256').update(opts.bytes).digest('hex');
  }

  /** The hooks of `base/hooks` built into `folder` with `bun build`, and the sums beside them. Deterministic: the same sources and bun give the same bytes. */
  static build(opts: { folder: string; version: string }): IHooksBundle {
    const hooks = join(BASE_DIRECTORY, 'hooks');

    rmSync(opts.folder, { recursive: true, force: true });
    mkdirSync(opts.folder, { recursive: true });

    for (const file of readdirSync(hooks)
      .filter((name) => name.endsWith('.ts'))
      .sort()) {
      const result = spawnSync(
        process.execPath,
        [
          'build',
          join(hooks, file),
          '--target',
          'bun',
          '--minify',
          '--outfile',
          join(opts.folder, `${basename(file, '.ts')}.js`),
        ],
        { encoding: 'utf8' },
      );

      if (result.status !== 0) {
        throw new Error(`bun build of ${file} failed: ${result.stderr}`);
      }
    }

    const files = Object.fromEntries(
      readdirSync(opts.folder)
        .filter((name) => name.endsWith('.js'))
        .sort()
        .map((name) => [
          name,
          HooksBundle.sha256({ bytes: readFileSync(join(opts.folder, name)) }),
        ]),
    );
    const sums: IHooksBundle = { version: opts.version, files };

    writeFileSync(join(opts.folder, SUMS_FILE), `${JSON.stringify(sums, null, 2)}\n`);

    return sums;
  }

  /** The sums the package ships, or `undefined` when it ships no bundle or the file is not what it should be. */
  static shipped(): IHooksBundle | undefined {
    try {
      const parsed: unknown = JSON.parse(readFileSync(join(HooksBundle.SOURCE, SUMS_FILE), 'utf8'));

      return isRecord(parsed) && typeof parsed['version'] === 'string' && isRecord(parsed['files'])
        ? {
            version: parsed['version'],
            files: Object.fromEntries(
              Object.entries(parsed['files']).filter(
                (entry): entry is [string, string] => typeof entry[1] === 'string',
              ),
            ),
          }
        : undefined;
    } catch {
      return undefined;
    }
  }

  /** The folder to copy from and its sums: the shipped bundle, or in a workspace that has none the one built now. */
  static source(): { folder: string; sums: IHooksBundle } | undefined {
    const sums = HooksBundle.shipped();

    if (sums !== undefined) {
      return { folder: HooksBundle.SOURCE, sums };
    }

    if (!existsSync(join(BASE_DIRECTORY, 'hooks', 'guard-git.ts'))) {
      return undefined;
    }

    if (HooksBundle.built === undefined) {
      const folder = mkdtempSync(join(tmpdir(), 'vulcan-hooks-'));
      const version = JSON.parse(
        readFileSync(join(BASE_DIRECTORY, '..', 'package.json'), 'utf8'),
      ).version;

      HooksBundle.built = { folder, sums: HooksBundle.build({ folder, version: String(version) }) };
    }

    return HooksBundle.built;
  }

  /** The version and sums a manifest's `hooks` block records, or `undefined` when it holds none. */
  private static recorded(opts: { block: unknown }): IHooksBundle | undefined {
    const { block } = opts;

    return isRecord(block) && typeof block['version'] === 'string' && isRecord(block['sha256'])
      ? {
          version: block['version'],
          files: Object.fromEntries(
            Object.entries(block['sha256']).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string',
            ),
          ),
        }
      : undefined;
  }

  /** What the manifest records: the shipped version and sums, or the block it already has when the bundle of that version differs from it. */
  static manifestBlock(opts: {
    previous: unknown;
    isPinned?: boolean;
  }): { version: string; folder: string; sha256: Record<string, string> } | undefined {
    const shipped = HooksBundle.shipped();

    if (shipped === undefined) {
      return undefined;
    }

    const recorded = HooksBundle.recorded({ block: opts.previous });
    const kept =
      HooksBundle.refusal({ shipped, previous: opts.previous, isPinned: opts.isPinned }) ===
      undefined
        ? undefined
        : recorded;
    const taken = kept ?? shipped;

    return { version: taken.version, folder: HookConstants.BUNDLE_DIRECTORY, sha256: taken.files };
  }

  /** Why the shipped bundle is not taken: the manifest records another sum for a file of the same version. `undefined` when it is. */
  static refusal(opts: {
    shipped: IHooksBundle;
    previous: unknown;
    /** Whether the recorded sums pin this package: an installed copy by default, the source tree of a workspace is not. */
    isPinned?: boolean;
  }): string | undefined {
    const recorded = HooksBundle.recorded({ block: opts.previous });

    if (!(opts.isPinned ?? HooksBundle.isInstalled())) {
      return undefined;
    }

    if (recorded === undefined || recorded.version !== opts.shipped.version) {
      return undefined;
    }

    const differs = Object.entries(opts.shipped.files).filter(
      ([name, sum]) => recorded.files[name] !== undefined && recorded.files[name] !== sum,
    );

    return differs.length === 0
      ? undefined
      : `the hook bundle of ${opts.shipped.version} differs from the sums the manifest records (${differs.map(([name]) => name).join(', ')}): not copied; the package is not the one this project was synced with`;
  }

  /** The copy of the bundle in the project's `.agents/local/hooks/`, read-only, planned for `sync` and `doctor`. */
  static plan(opts: { root: string; previous: unknown; isPinned?: boolean }): ISyncAction[] {
    const target = join(opts.root, HookConstants.BUNDLE_DIRECTORY);
    const source = HooksBundle.source();

    if (source === undefined) {
      return [
        {
          path: target,
          status: SyncStatuses.SKIPPED,
          note: 'this package ships no hook bundle: reinstall it, or run make build in the workspace',
          apply: () => {},
        },
      ];
    }

    const refusal = HooksBundle.refusal({
      shipped: source.sums,
      previous: opts.previous,
      isPinned: opts.isPinned,
    });

    if (refusal !== undefined) {
      return [{ path: target, status: SyncStatuses.SKIPPED, note: refusal, apply: () => {} }];
    }

    // What was shipped must be what the sums say, byte for byte, before a single file is copied.
    const corrupt = Object.entries(source.sums.files).filter(([name, sum]) => {
      try {
        return HooksBundle.sha256({ bytes: readFileSync(join(source.folder, name)) }) !== sum;
      } catch {
        return true;
      }
    });

    if (corrupt.length > 0) {
      return [
        {
          path: target,
          status: SyncStatuses.SKIPPED,
          note: `the hook bundle is not what its sums say (${corrupt.map(([name]) => name).join(', ')}): not copied`,
          apply: () => {},
        },
      ];
    }

    const present = existsSync(target)
      ? readdirSync(target).filter((name) => name.endsWith('.js'))
      : [];
    const isCurrent =
      present.length === Object.keys(source.sums.files).length &&
      Object.entries(source.sums.files).every(([name, sum]) => {
        try {
          return HooksBundle.sha256({ bytes: readFileSync(join(target, name)) }) === sum;
        } catch {
          return false;
        }
      });

    if (isCurrent) {
      return [{ path: target, status: SyncStatuses.UNCHANGED, apply: () => {} }];
    }

    return [
      {
        path: target,
        status: existsSync(target) ? SyncStatuses.REPLACED : SyncStatuses.CREATED,
        note: `the hooks the guards run, ${Object.keys(source.sums.files).length} files, version ${source.sums.version}, read-only`,
        apply: () => {
          mkdirSync(target, { recursive: true });

          // A file this version no longer has goes; a read-only file is removed before it is written again.
          for (const name of present) {
            rmSync(join(target, name), { force: true });
          }

          for (const name of Object.keys(source.sums.files)) {
            const file = join(target, name);

            writeFileSync(file, readFileSync(join(source.folder, name)));
            chmodSync(file, 0o444);
          }
        },
      },
    ];
  }
}
