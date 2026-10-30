import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ExitCodes, PACKAGE_NAME, readProperty, UpgradeFlags } from '../common/index.ts';
import type { ICommandContext } from '../common/index.ts';
import { CreateConstants } from '../create/common/index.ts';
import { bunExecutable, isInstallSkipped, runBun } from '../create/process.ts';

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

/** A tag that is present must be a plain version; anything else cannot be compared or installed. */
const parseTag = (opts: { tags: unknown; key: keyof IDistTags }): string | undefined | null => {
  const value = readProperty({ value: opts.tags, key: opts.key });

  if (value === undefined) {
    return undefined;
  }

  return typeof value === 'string' && CreateConstants.VERSION_PATTERN.test(value) ? value : null;
};

/** The `latest` and `next` tags of a registry answer, or undefined when it is not an object of versions. */
export const parseDistTags = (opts: { text: string }): IDistTags | undefined => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(opts.text);
  } catch {
    return undefined;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }

  const latest = parseTag({ tags: parsed, key: 'latest' });
  const next = parseTag({ tags: parsed, key: 'next' });

  return latest === null || next === null ? undefined : { latest, next };
};

/**
 * The one place that reads the registry: `bun pm view` goes through the project's own registry and
 * auth settings. `VULCAN_DIST_TAGS` replaces it so tests run offline. Undefined when the read fails,
 * after printing why bun failed.
 */
export const readDistTags = async (opts: { cwd: string }): Promise<IDistTags | undefined> => {
  const injected = process.env[UpgradeFlags.DIST_TAGS_ENV];

  if (injected !== undefined) {
    return parseDistTags({ text: injected });
  }

  const child = Bun.spawn([bunExecutable(), 'pm', 'view', PACKAGE_NAME, 'dist-tags', '--json'], {
    cwd: opts.cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [text, errorText] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  const exitCode = await child.exited;

  if (exitCode !== ExitCodes.OK) {
    process.stderr.write(errorText.endsWith('\n') ? errorText : `${errorText}\n`);

    return undefined;
  }

  return parseDistTags({ text });
};

/** The higher of the two tags by semver, so a stale `next` never pulls a project below the stable release. */
export const pickNightly = (opts: IDistTags): string | undefined => {
  const { latest, next } = opts;

  if (latest === undefined || next === undefined) {
    return latest ?? next;
  }

  return Bun.semver.order(next, latest) === 1 ? next : latest;
};

/** The version of the `@venizia/vulcan` the project has installed, undefined when none is readable. */
const readInstalledVersion = (opts: { cwd: string }): string | undefined => {
  const file = join(opts.cwd, 'node_modules', PACKAGE_NAME, 'package.json');

  if (!existsSync(file)) {
    return undefined;
  }

  try {
    const version = readProperty({ value: JSON.parse(readFileSync(file, 'utf8')), key: 'version' });

    return typeof version === 'string' ? version : undefined;
  } catch {
    return undefined;
  }
};

/**
 * What to install: an explicit version or tag wins over the channel; `--nightly` is the newest of the
 * `latest` and `next` tags; otherwise `latest`. Undefined, after saying why on stderr, when `--nightly`
 * cannot be resolved.
 */
export const resolveUpgradeTarget = async (opts: ICommandContext): Promise<string | undefined> => {
  const explicit = opts.args.find((arg) => !arg.startsWith('-'));

  if (explicit !== undefined) {
    return explicit;
  }

  if (!opts.args.includes(UpgradeFlags.NIGHTLY)) {
    const installed = readInstalledVersion({ cwd: opts.cwd });

    if (installed !== undefined && CreateConstants.PRERELEASE_PATTERN.test(installed)) {
      process.stderr.write(
        `vulcan upgrade: ${installed} is installed, a prerelease; ${UpgradeFlags.STABLE} installs the latest stable release and ${UpgradeFlags.NIGHTLY} keeps the prerelease line\n`,
      );
    }

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
