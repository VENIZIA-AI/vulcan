#!/usr/bin/env bun
import { AtlasCommands, AtlasConstants } from './common';
import {
  findPackageDirectory,
  isBareInteractiveRun,
  ModeUsageError,
  readPackageVersion,
  readRootArgument,
  readSourceArguments,
  readUserSources,
} from './cli/index';
import { runChangelogsCommand } from './changelogs/command';
import { runConceptsCommand } from './concepts/command';
import { runReleasesCommand } from './releases/generator';
import { buildSourcesServer, refreshIntervalMs } from './server/index';
import type { Transport } from './protocol/index';
import { hasAtlasProject, readAtlasProject } from './common/project-config';
import { resolveServableSources, resolveSources } from './sources/index';
import type { IAtlasSource } from './sources/index';
import { runSurfaceCommand } from './surface/index';
import { runSymbolsCommand } from './symbols/generator';

const USAGE = `usage: ${AtlasConstants.SERVER_NAME} [mcp] [--root <dir>] [--source <owner/repo>@<ref>]... | pull [--source <name>] | tools [--root <dir>] | <surface|symbols|releases> | changelogs migrate [--dry-run] | concepts stamp|check | help`;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const usageError = (message: string): never => {
  console.error(`${AtlasConstants.SERVER_NAME}: ${message}\n${USAGE}`);
  process.exit(2);
};

const HELP_FLAGS = new Set(['--help', '-h']);

const readSubcommand = (opts: { argv: string[] }): string => {
  const [first] = opts.argv;

  if (isBareInteractiveRun({ argv: opts.argv, isTty: process.stdin.isTTY === true })) {
    return AtlasCommands.HELP;
  }

  if (first !== undefined && HELP_FLAGS.has(first)) {
    return AtlasCommands.HELP;
  }

  return first === undefined || first.startsWith('--') ? AtlasCommands.MCP : first;
};

// package.json has no version yet only in a manifest hand-edited before its first publish.
const FALLBACK_VERSION = '0.0.0';

const GENERATOR_BY_COMMAND: Record<string, (opts: { command?: string }) => number> = {
  [AtlasCommands.SURFACE]: runSurfaceCommand,
  [AtlasCommands.SYMBOLS]: runSymbolsCommand,
  [AtlasCommands.RELEASES]: runReleasesCommand,
};

const argv = process.argv.slice(2);
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
  process.exit(generator({ command: argv[1] }));
}

if (subcommand === AtlasCommands.CHANGELOGS) {
  try {
    process.exit(runChangelogsCommand({ command: argv[1], argv }));
  } catch (error) {
    console.error(`${AtlasConstants.SERVER_NAME}: ${messageOf(error)}`);
    process.exit(1);
  }
}

if (subcommand === AtlasCommands.CONCEPTS) {
  try {
    process.exit(runConceptsCommand({ command: argv[1] }));
  } catch (error) {
    console.error(`${AtlasConstants.SERVER_NAME}: ${messageOf(error)}`);
    process.exit(1);
  }
}

/**
 * The sources to serve: the project's own (repo mode) and the sources its manifest declares, plus
 * `--source`; outside any project, `--source` and the user config. atlas ships code only - with
 * none of these there is nothing to serve.
 */
const sourcesToServe = (opts: {
  root: string;
  argv: string[];
}): { project: boolean; sources: IAtlasSource[] } => {
  const project = hasAtlasProject({ root: opts.root });
  const declared = project ? readAtlasProject({ root: opts.root }).sources : readUserSources();

  return { project, sources: [...declared, ...readSourceArguments({ argv: opts.argv })] };
};

/** The server for the sources `root` serves; `undefined` when there is nothing to serve at all. */
const buildServer = async (opts: {
  root: string;
  version: string;
}): Promise<Transport | undefined> => {
  const { project, sources } = sourcesToServe({ root: opts.root, argv });

  if (!project && sources.length === 0) {
    return undefined;
  }

  const { resolved, unavailable } = await resolveServableSources({ cwd: opts.root, sources });

  for (const { source, reason } of unavailable) {
    console.error(
      `${AtlasConstants.SERVER_NAME}: source '${source.name}' is not served - ${reason}`,
    );
  }

  if (resolved.length === 0) {
    usageError('nothing to serve - every source is unavailable (above)');
  }

  const intervalMs = refreshIntervalMs();

  return buildSourcesServer({
    sources: resolved,
    unavailable,
    cwd: opts.root,
    version: opts.version,
    ...(intervalMs === undefined ? {} : { refresh: { intervalMs } }),
  });
};

/** `pull [--source <name>]`: every source fetched again, or the one named; repo mode needs no pull. */
const pull = async (): Promise<number> => {
  const root = readRootArgument({ argv }).value;
  const flag = argv.indexOf('--source');
  const wanted = flag === -1 || argv[flag + 1]?.includes('/') ? undefined : argv[flag + 1];
  // A name picks a source; it is never a source of its own.
  const { sources } = sourcesToServe({
    root,
    argv:
      wanted === undefined ? argv : argv.filter((_, index) => index !== flag && index !== flag + 1),
  });
  const named = sources.filter((source) => wanted === undefined || source.name === wanted);

  if (wanted !== undefined && named.length === 0) {
    usageError(
      `pull: no source named '${wanted}' - known sources: ${sources.map((source) => source.name).join(', ') || 'none'}`,
    );
  }

  const pulled = await resolveSources({ cwd: root, sources: named, force: true });

  for (const source of pulled.filter((entry) => entry.mode !== 'repository')) {
    console.log(`pull: ${source.name} ${(source.sha ?? '').slice(0, 8)} (${source.mode})`);
  }

  return 0;
};

const NOTHING_TO_SERVE = (opts: { root: string }): string =>
  `nothing to serve at ${opts.root} - run in a project (\`vulcan sync\` writes .agents/vulcan.manifest.json), or pass --source <owner/repo>@<ref>, or list sources in $XDG_CONFIG_HOME/vulcan/atlas.json`;

/** The server the arguments ask for; a usage error names what is missing. */
const readServer = async (): Promise<Transport> => {
  let root: string;

  try {
    root = readRootArgument({ argv }).value;
  } catch (error) {
    if (error instanceof ModeUsageError) {
      usageError(error.message);
    }

    throw error;
  }

  const version =
    readPackageVersion({ directory: findPackageDirectory({ startDirectory: __dirname }) }) ??
    FALLBACK_VERSION;

  const server = await buildServer({ root, version });

  if (server === undefined) {
    return usageError(NOTHING_TO_SERVE({ root }));
  }

  return server;
};

/** `tools`: what `tools/list` answers, one line per tool - the way to check a setup without an MCP client. */
const listTools = async (): Promise<void> => {
  const server = await readServer();

  for (const tool of server.listTools()) {
    console.log(`${tool.name.padEnd(8)} ${tool.description.split('. ')[0]}`);
  }
};

const main = async (): Promise<void> => {
  if (subcommand === AtlasCommands.PULL) {
    process.exit(await pull());
  }

  if (subcommand === AtlasCommands.TOOLS) {
    await listTools();

    return;
  }

  await (await readServer()).run();
};

main().catch((error: unknown) => {
  console.error(`${AtlasConstants.SERVER_NAME}: ${messageOf(error)}`);
  process.exit(1);
});
