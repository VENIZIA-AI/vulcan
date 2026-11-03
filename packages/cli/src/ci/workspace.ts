import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { RecordValue } from '../common/record.ts';
import { CiConstants } from './common/index.ts';
import type { IDependency, IWorkspacePackage } from './common/index.ts';

type TWorkspaceRead = { ok: true; packages: IWorkspacePackage[] } | { ok: false; error: string };

/** The packages of the workspace: the folders the root `package.json` lists in `workspaces`. */
export class CiWorkspace {
  /**
   * Every folder with a `package.json` that the `workspaces` globs match (an array, or an object with
   * `packages`; a `!` glob removes), with a name, sorted by folder. `node_modules` is never searched.
   */
  static read(opts: { root: string }): TWorkspaceRead {
    const file = join(opts.root, CiConstants.ROOT_MANIFEST);

    if (!existsSync(file)) {
      return { ok: false, error: `no ${CiConstants.ROOT_MANIFEST} in ${opts.root}` };
    }

    let manifest: unknown;

    try {
      manifest = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      return {
        ok: false,
        error: `${CiConstants.ROOT_MANIFEST} is not JSON: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const globs = RecordValue.isRecord(manifest)
      ? CiWorkspace.globsOf({ value: manifest.workspaces })
      : [];

    if (globs.length === 0) {
      return { ok: false, error: `${CiConstants.ROOT_MANIFEST} lists no workspaces` };
    }

    const include = globs.filter((glob) => !glob.startsWith('!'));
    const exclude = globs
      .filter((glob) => glob.startsWith('!'))
      .map((glob) => new Bun.Glob(glob.slice(1)));
    const dirs = new Set<string>();

    for (const glob of include) {
      const scan = new Bun.Glob(`${glob.replace(/\/+$/, '')}/${CiConstants.ROOT_MANIFEST}`);

      for (const match of scan.scanSync({ cwd: opts.root, onlyFiles: true })) {
        const dir = dirname(match).split('\\').join('/');

        if (
          !dir.split('/').includes('node_modules') &&
          !exclude.some((pattern) => pattern.match(dir))
        ) {
          dirs.add(dir);
        }
      }
    }

    const packages = [...dirs]
      .sort()
      .flatMap((dir) => CiWorkspace.packageAt({ root: opts.root, dir }) ?? []);

    return { ok: true, packages };
  }

  private static globsOf(opts: { value: unknown }): string[] {
    const list = Array.isArray(opts.value)
      ? opts.value
      : RecordValue.isRecord(opts.value) && Array.isArray(opts.value.packages)
        ? opts.value.packages
        : [];

    return list.filter((entry): entry is string => typeof entry === 'string' && entry !== '');
  }

  private static packageAt(opts: { root: string; dir: string }): IWorkspacePackage | undefined {
    let manifest: unknown;

    try {
      manifest = JSON.parse(
        readFileSync(join(opts.root, opts.dir, CiConstants.ROOT_MANIFEST), 'utf8'),
      );
    } catch {
      return undefined;
    }

    if (
      !RecordValue.isRecord(manifest) ||
      typeof manifest.name !== 'string' ||
      manifest.name === ''
    ) {
      return undefined;
    }

    const scripts = RecordValue.isRecord(manifest.scripts)
      ? Object.fromEntries(
          Object.entries(manifest.scripts).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        )
      : {};
    const dependencies: IDependency[] = CiConstants.DEPENDENCY_FIELDS.flatMap((field) => {
      const block = manifest[field];

      return RecordValue.isRecord(block)
        ? Object.entries(block)
            .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
            .map(([name, spec]) => ({ name, spec }))
        : [];
    });

    return { name: manifest.name, dir: opts.dir, scripts, dependencies };
  }
}
