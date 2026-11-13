#!/usr/bin/env bun
import { AtlasCommands, AtlasConstants } from './common';
import { InteractiveRun, ModeArguments, ModeUsageError, SourceArguments } from './cli/index';
import { runReleasesCommand } from './releases/generator';
import { Refresher, SourceBoot, SourcesServer } from './server/index';
import type { Transport } from './protocol/index';
import { AtlasLimits } from './common/limits';
import { ProjectConfig } from './common/project-config';
import { TextValue } from './common/text';
import { runIndexCommand } from './prebuilt/index';
import { SourceResolver } from './sources/index';
import type { IAtlasSource } from './sources/index';
import { runApiCommand } from './api/index';
import { runSurfaceCommand } from './surface/index';
import { runSymbolsCommand } from './symbols/generator';
import { MigrateCommand, runChangelogsCommand } from './migrations/index';

const USAGE = `usage: ${AtlasConstants.SERVER_NAME} [mcp] [--root <dir>] [--source <owner/repo>@<ref>]... [--cache-dir <dir>] | pull [--source <name>] [--cache-dir <dir>] [--no-prebuilt] [--warm] | index --out <dir> [--key-env <name>] [--repo <owner/name>] [--root <dir>] | index keygen | index publish [--key-env <name>] | tools [--root <dir>] | <surface|api|symbols|releases|changelogs check> | migrate plan [--package <name>] [--from <version>] --to <version|latest|next> [--app <dir>] [--format md|json] [--verbose] | migrate apply [--package <name>] [--from <version>] --to <version|latest|next> [--app <dir>] [--force] | help`;

const usageError = (message: string): never => {
  console.error(`${AtlasConstants.SERVER_NAME}: ${message}\n${USAGE}`);
  process.exit(2);
};

const HELP_FLAGS = new Set(['--help', '-h']);

const readSubcommand = (opts: { argv: string[] }): string => {
  const [first] = opts.argv;

  if (InteractiveRun.isBare({ argv: opts.argv, isTty: process.stdin.isTTY === true })) {
    return AtlasCommands.HELP;
  }

  if (first !== undefined && HELP_FLAGS.has(first)) {
    return AtlasCommands.HELP;
  }

  return first === undefined || first.startsWith('--') ? AtlasCommands.MCP : first;
};

/** The version atlas reports: its own package.json's. A package.json without one is an invalid manifest. */
const packageVersion = (): string => {
  const version = ModeArguments.readPackageVersion({
    directory: ModeArguments.findPackageDirectory({ startDirectory: __dirname }),
  });

  if (version === undefined) {
    throw new Error('its package.json declares no version');
  }

  return version;
};

const GENERATOR_BY_COMMAND: Record<
  string,
  (opts: { command?: string; args?: string[] }) => number
> = {
  [AtlasCommands.SURFACE]: runSurfaceCommand,
  [AtlasCommands.API]: runApiCommand,
  [AtlasCommands.SYMBOLS]: runSymbolsCommand,
  [AtlasCommands.RELEASES]: runReleasesCommand,
  [AtlasCommands.CHANGELOGS]: runChangelogsCommand,
};

const argv = process.argv.slice(2);
/**
 * Whether this start may download a prebuilt index: not with `--no-prebuilt`, and not when the project's
 * manifest (`atlas.prebuilt: false`) turns it off. Every source is then built here.
 */
const prebuiltAllowed = (opts: { root: string }): boolean =>
  !argv.includes('--no-prebuilt') &&
  !(
    ProjectConfig.hasAtlasProject({ root: opts.root }) &&
    ProjectConfig.readAtlasProject({ root: opts.root }).prebuilt === false
  );
const subcommand = readSubcommand({ argv });

if (!AtlasCommands.isValid(subcommand)) {
  usageError(`unknown subcommand: ${subcommand}`);
}

if (subcommand === AtlasCommands.HELP) {
  console.log(USAGE);
  process.exit(0);
}

const generator = GENERATOR_BY_COMMAND[subcommand];

if (generator) {
  process.exit(generator({ command: argv[1], args: argv.slice(2) }));
}

/**
 * The sources to serve: the project's own (repo mode) and the sources its manifest declares, plus
 * `--source`; outside any project, `--source` alone. atlas ships code only - with none of these
 * there is nothing to serve. Nothing is read from outside the project directory.
 */
const sourcesToServe = (opts: {
  root: string;
  argv: string[];
}): { project: boolean; sources: IAtlasSource[] } => {
  const project = ProjectConfig.hasAtlasProject({ root: opts.root });
  const declared = project ? ProjectConfig.readAtlasProject({ root: opts.root }).sources : [];

  // What this project allows a download to hold: set once, before any source is fetched.
  AtlasLimits.configure({
    download: project
      ? ProjectConfig.readAtlasProject({ root: opts.root }).downloadLimit
      : undefined,
  });

  return { project, sources: [...declared, ...SourceArguments.read({ argv: opts.argv })] };
};

/** The server for the sources `root` serves; `undefined` when there is nothing to serve at all. */
const buildServer = async (opts: {
  root: string;
  version: string;
}): Promise<{ server: Transport; boot: SourceBoot } | undefined> => {
  const { project, sources } = sourcesToServe({ root: opts.root, argv });

  if (!project && sources.length === 0) {
    return undefined;
  }

  const cacheDir = ModeArguments.readCacheDir({ argv });
  const prebuilt = prebuiltAllowed({ root: opts.root });
  // The project itself is read at once; the remote sources are fetched and indexed in child processes
  // while the server already answers, so a cold cache never holds up `initialize`.
  const { resolved } = await SourceResolver.resolveServable({
    cwd: opts.root,
    sources: [],
    cacheDir,
    prebuilt,
  });
  const forwarded = [
    '--root',
    opts.root,
    ...(cacheDir === undefined ? [] : [`--cache-dir=${cacheDir}`]),
    ...(prebuilt ? [] : ['--no-prebuilt']),
    // The `--source` arguments the parent read, in both spellings, so the child sees the same sources.
    ...argv.flatMap((arg, index) =>
      arg === '--source' ? [arg, argv[index + 1] ?? ''] : arg.startsWith('--source=') ? [arg] : [],
    ),
  ];
  const boot = new SourceBoot({
    sources,
    indexer: ({ source }) =>
      SourceBoot.indexInChild({
        source,
        args: forwarded,
        timeoutMs: SourceBoot.buildTimeoutMs(),
      }),
  });
  const intervalMs = Refresher.configuredIntervalMs();

  const server = SourcesServer.build({
    sources: resolved,
    cwd: opts.root,
    cacheDir,
    prebuilt,
    version: opts.version,
    boot,
    ...(intervalMs === undefined ? {} : { refresh: { intervalMs } }),
  });

  return { server, boot };
};

/**
 * `pull [--source <name>]`: every source fetched again, or the one named; repo mode needs no pull.
 * `--warm` fetches and indexes only what the cache lacks. `--only <name>` names the source apart from
 * `--source`, and `--json` prints the one resolved source as a JSON line: the way the server asks a child
 * process to index a source while it already answers (the build is synchronous work).
 */
const pull = async (): Promise<number> => {
  const root = ModeArguments.readRoot({ argv }).value;
  const flag = argv.indexOf('--source');
  const only = argv.indexOf('--only');
  const wanted =
    only !== -1
      ? argv[only + 1]
      : flag === -1 || argv[flag + 1]?.includes('/')
        ? undefined
        : argv[flag + 1];
  // A name picks a source; it is never a source of its own.
  const { sources } = sourcesToServe({
    root,
    argv:
      only !== -1
        ? argv
        : wanted === undefined
          ? argv
          : argv.filter((_, index) => index !== flag && index !== flag + 1),
  });
  const named = sources.filter((source) => wanted === undefined || source.name === wanted);

  if (wanted !== undefined && named.length === 0) {
    usageError(
      `pull: no source named '${wanted}' - known sources: ${sources.map((source) => source.name).join(', ') || 'none'}`,
    );
  }

  const pulled = await SourceResolver.resolve({
    cwd: root,
    sources: named,
    cacheDir: ModeArguments.readCacheDir({ argv }),
    force: !argv.includes('--warm'),
    prebuilt: prebuiltAllowed({ root }),
  });

  if (argv.includes('--json')) {
    const [remote] = pulled.filter((entry) => entry.mode !== 'repository');
    // The promise of a symbol fetch still running is not data; the child keeps running to finish it.
    const { symbolsPending: _pending, ...plain } = remote ?? {};

    await new Promise<void>((done) => {
      process.stdout.write(
        `${JSON.stringify({ source: remote === undefined ? null : plain })}\n`,
        () => done(),
      );
    });
    await remote?.symbolsPending;

    return 0;
  }

  for (const source of pulled.filter((entry) => entry.mode !== 'repository')) {
    console.log(`pull: ${source.name} ${(source.sha ?? '').slice(0, 8)} (${source.mode})`);
  }

  return 0;
};

const NOTHING_TO_SERVE = (opts: { root: string }): string =>
  `nothing to serve at ${opts.root} - run in a project (\`vulcan sync\` writes .agents/vulcan.manifest.json), or pass --source <owner/repo>@<ref>`;

/** The server the arguments ask for; a usage error names what is missing. */
const readServer = async (): Promise<{ server: Transport; boot: SourceBoot }> => {
  let root: string;

  try {
    root = ModeArguments.readRoot({ argv }).value;
  } catch (error) {
    if (error instanceof ModeUsageError) {
      usageError(error.message);
    }

    throw error;
  }

  const built = await buildServer({ root, version: packageVersion() });

  if (built === undefined) {
    return usageError(NOTHING_TO_SERVE({ root }));
  }

  return built;
};

/** `tools`: what `tools/list` answers, one line per tool - the way to check a setup without an MCP client. */
const listTools = async (): Promise<void> => {
  const { server, boot } = await readServer();

  // The listing needs no source, but a setup check should say when none can be served.
  await boot.settled;

  if (
    boot.declared.length > 0 &&
    boot.unavailable().length === boot.declared.length &&
    !ProjectConfig.hasAtlasProject({ root: ModeArguments.readRoot({ argv }).value })
  ) {
    for (const { source, reason } of boot.unavailable()) {
      console.error(
        `${AtlasConstants.SERVER_NAME}: source '${source.name}' is not served - ${reason}`,
      );
    }

    usageError('nothing to serve - every source is unavailable (above)');
  }

  for (const tool of server.listTools()) {
    console.log(`${tool.name.padEnd(8)} ${tool.description.split('. ')[0]}`);
  }

  // Leave at once: a child may still be filling its caches.
  process.exit(0);
};

const main = async (): Promise<void> => {
  // A flag with no value is the same usage error whether or not there is anything to serve.
  ModeArguments.readCacheDir({ argv });

  if (subcommand === AtlasCommands.PULL) {
    const result = await pull();
    process.exit(result);
  }

  if (subcommand === AtlasCommands.INDEX) {
    const result2 = await runIndexCommand({
      argv,
      version: packageVersion(),
    });
    process.exit(result2);
  }

  if (subcommand === AtlasCommands.TOOLS) {
    await listTools();

    return;
  }

  if (subcommand === AtlasCommands.MIGRATE) {
    const { server, boot } = await readServer();

    // Every source indexed first: the plan needs the whole release table, not the sources ready so far.
    await boot.settled;

    const code = await MigrateCommand.run({
      args: argv.slice(1),
      send: (line) => server.handleLine({ line }),
      out: (text) => process.stdout.write(text),
      err: (text) => process.stderr.write(text),
    });

    process.exit(code);
  }

  const { server, boot } = await readServer();

  // With no project of its own, a server whose every source failed has nothing to serve: say so and stop, as before.
  if (
    boot.declared.length > 0 &&
    !ProjectConfig.hasAtlasProject({ root: ModeArguments.readRoot({ argv }).value })
  ) {
    boot.settled
      .then(() => {
        if (boot.unavailable().length === boot.declared.length) {
          for (const { source, reason } of boot.unavailable()) {
            console.error(
              `${AtlasConstants.SERVER_NAME}: source '${source.name}' is not served - ${reason}`,
            );
          }

          console.error(
            `${AtlasConstants.SERVER_NAME}: nothing to serve - every source is unavailable (above)`,
          );
          process.exit(2);
        }
      })
      .catch(() => undefined);
  }

  await server.run();
  // The client closed the input: let the last reply reach the pipe, then leave and take the indexing children along.
  await new Promise<void>((done) => {
    process.stdout.write('', () => done());
  });
  process.exit(0);
};

main().catch((error: unknown) => {
  if (error instanceof ModeUsageError) {
    usageError(error.message);
  }

  console.error(`${AtlasConstants.SERVER_NAME}: ${TextValue.messageOf({ error })}`);
  process.exit(1);
});
