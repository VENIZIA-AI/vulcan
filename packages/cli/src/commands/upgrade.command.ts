import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ExitCodes, PACKAGE_NAME, UpgradeFlags } from '../common/index.ts';
import type { ICommandContext } from '../common/index.ts';
import { isInstallSkipped, runBun } from '../create/process.ts';

/** `latest` is the stable channel: never a prerelease. */
const DEFAULT_TARGET = 'latest';

interface IDistTags {
  latest?: string;
  next?: string;
}

export const buildUpgradeArgs = (opts: { target?: string }): string[] => [
  'add',
  '--dev',
  '--exact',
  `${PACKAGE_NAME}@${opts.target ?? DEFAULT_TARGET}`,
];

/**
 * The one place that reads the registry: `bun pm view` goes through the project's own registry and
 * auth settings. `VULCAN_DIST_TAGS` replaces it so tests run offline. Undefined when the read fails.
 */
export const readDistTags = async (opts: { cwd: string }): Promise<IDistTags | undefined> => {
  const injected = process.env[UpgradeFlags.DIST_TAGS_ENV];
  let text = injected;

  if (text === undefined) {
    const child = Bun.spawn([process.execPath, 'pm', 'view', PACKAGE_NAME, 'dist-tags', '--json'], {
      cwd: opts.cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    text = await new Response(child.stdout).text();

    if ((await child.exited) !== ExitCodes.OK) {
      return undefined;
    }
  }

  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** The higher of the two tags by semver, so a stale `next` never pulls a project below the stable release. */
export const pickNightly = (opts: IDistTags): string | undefined => {
  const { latest, next } = opts;

  if (latest === undefined || next === undefined) {
    return latest ?? next;
  }

  return Bun.semver.order(next, latest) === 1 ? next : latest;
};

/**
 * What to install: an explicit version or tag wins over the channel; `--nightly` is the newest of the
 * `latest` and `next` tags; otherwise `latest`. Undefined, after saying why on stderr, when `--nightly`
 * cannot be resolved.
 */
export const resolveUpgradeTarget = async (opts: ICommandContext): Promise<string | undefined> => {
  const explicit = opts.args.find(arg => !arg.startsWith('-'));

  if (explicit !== undefined) {
    return explicit;
  }

  if (!opts.args.includes(UpgradeFlags.NIGHTLY)) {
    return DEFAULT_TARGET;
  }

  const tags = await readDistTags({ cwd: opts.cwd });
  const target = tags === undefined ? undefined : pickNightly(tags);

  if (target === undefined) {
    process.stderr.write(
      `vulcan upgrade: ${UpgradeFlags.NIGHTLY} could not read the dist-tags of ${PACKAGE_NAME} - pass a version instead\n`,
    );
  }

  return target;
};

/**
 * Runs `sync` from the CLI the install just wrote, as a child: this process still holds the old
 * version's code and base, so an in-process sync would write the old adapters.
 */
export const runInstalledSync = async (opts: { cwd: string }): Promise<number> => {
  const bin = join(opts.cwd, 'node_modules', '.bin', 'vulcan');

  if (!existsSync(bin)) {
    process.stderr.write(
      `vulcan upgrade: no installed vulcan at ${bin} - the install did not complete\n`,
    );

    return ExitCodes.FAILURE;
  }

  const child = Bun.spawn([process.execPath, bin, 'sync'], {
    cwd: opts.cwd,
    stdio: ['inherit', 'inherit', 'inherit'],
  });

  return child.exited;
};

/** Installs the target version, then syncs with it, so the adapters always match the installed base. */
export const runUpgradeCommand = async (opts: ICommandContext): Promise<number> => {
  if (opts.args.includes(UpgradeFlags.STABLE) && opts.args.includes(UpgradeFlags.NIGHTLY)) {
    process.stderr.write(
      `vulcan upgrade: ${UpgradeFlags.STABLE} and ${UpgradeFlags.NIGHTLY} cannot be combined - pick one\n`,
    );

    return ExitCodes.FAILURE;
  }

  const target = await resolveUpgradeTarget(opts);

  if (target === undefined) {
    return ExitCodes.FAILURE;
  }

  const args = buildUpgradeArgs({ target });
  const code = await runBun({ cwd: opts.cwd, args, label: `bun ${args.join(' ')}` });

  if (code !== ExitCodes.OK) {
    return code;
  }

  if (isInstallSkipped()) {
    process.stderr.write('  skipped  vulcan sync (VULCAN_NO_INSTALL)\n');

    return ExitCodes.OK;
  }

  return runInstalledSync({ cwd: opts.cwd });
};
