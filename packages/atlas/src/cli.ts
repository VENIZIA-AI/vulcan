#!/usr/bin/env bun
import { AtlasCommands, AtlasConstants } from './common';
import type { TAtlasMode } from './common';
import {
  findPackageDirectory,
  ModeUsageError,
  readPackageVersion,
  readRootArgument,
  readSourceArguments,
  readUserSources,
  resolveMode,
} from './cli/index';
import { runChangelogsCommand } from './changelogs/command';
import { runReleasesCommand } from './releases/generator';
import { buildServer } from './server';
import { buildSourcesServer } from './server/index';
import { hasAtlasProject, readAtlasProject } from './common/project-config';
import { resolveSources } from './sources/index';
import type { IAtlasSource } from './sources/index';
import { runSurfaceCommand } from './surface/index';
import { runSymbolsCommand } from './symbols/generator';

const USAGE = `usage: ${AtlasConstants.SERVER_NAME} [mcp] [--root <dir>] [--source <owner/repo>@<ref>]... | pull [--source <name>] | <surface|symbols|releases> | changelogs migrate [--dry-run]`;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const usageError = (message: string): never => {
  console.error(`${AtlasConstants.SERVER_NAME}: ${message}\n${USAGE}`);
  process.exit(2);
};

const readSubcommand = (opts: { argv: string[] }): string => {
  const [first] = opts.argv;

  return first === undefined || first.startsWith('--') ? AtlasCommands.MCP : first;
};

// package.json has no version yet only in a manifest hand-edited before its first publish.
const FALLBACK_VERSION = '0.0.0';

/** Resolves `{ mode, root, version }` from `argv`, or prints usage and exits 2 - never throws. */
const resolveServerOptions = (opts: {
  argv: string[];
}): { mode: TAtlasMode; root: string; version: string } => {
  try {
    const packageDirectory = findPackageDirectory({ startDirectory: __dirname });
    const rootArgument = readRootArgument({ argv: opts.argv });
    const { mode, root } = resolveMode({
      root: rootArgument.value,
      packageDirectory,
      explicitRoot: rootArgument.explicit,
    });
    const version = readPackageVersion({ directory: packageDirectory }) ?? FALLBACK_VERSION;

    return { mode, root, version };
  } catch (error) {
    if (error instanceof ModeUsageError) {
      return usageError(error.message);
    }

    throw error;
  }
};

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

/**
 * The sources to serve: the project's own (repo mode) and the sources its manifest declares, plus
 * `--source`; outside any project, `--source` and the user config. None at all: the packaged
 * snapshot, until it is retired.
 */
const sourcesToServe = (opts: { root: string }): { project: boolean; sources: IAtlasSource[] } => {
  const project = hasAtlasProject({ root: opts.root });
  const declared = project ? readAtlasProject({ root: opts.root }).sources : readUserSources();

  return { project, sources: [...declared, ...readSourceArguments({ argv })] };
};

const serveSources = async (opts: { root: string; version: string }): Promise<boolean> => {
  const { project, sources } = sourcesToServe({ root: opts.root });

  if (!project && sources.length === 0) {
    return false;
  }

  const resolved = await resolveSources({ cwd: opts.root, sources });

  await buildSourcesServer({ sources: resolved, cwd: opts.root, version: opts.version }).run();

  return true;
};

/** `pull [--source <name>]`: every source fetched again, or the one named; repo mode needs no pull. */
const pull = async (): Promise<number> => {
  const root = readRootArgument({ argv }).value;
  const flag = argv.indexOf('--source');
  const wanted = flag === -1 || argv[flag + 1]?.includes('/') ? undefined : argv[flag + 1];
  const { sources } = sourcesToServe({ root });
  const pulled = await resolveSources({
    cwd: root,
    sources: sources.filter(source => wanted === undefined || source.name === wanted),
    force: true,
  });

  for (const source of pulled.filter(entry => entry.mode !== 'repository')) {
    console.log(`pull: ${source.name} ${(source.sha ?? '').slice(0, 8)} (${source.mode})`);
  }

  return 0;
};

/** `mcp`: the sources when there are any (a project, `--source`, the user config), else the snapshot. */
const serve = async (): Promise<void> => {
  const rootArgument = readRootArgument({ argv });
  const version =
    readPackageVersion({ directory: findPackageDirectory({ startDirectory: __dirname }) }) ??
    FALLBACK_VERSION;

  if (await serveSources({ root: rootArgument.value, version })) {
    return;
  }

  const { mode, root } = resolveServerOptions({ argv });

  await buildServer({ mode, root, version }).run();
};

const main = async (): Promise<void> => {
  if (subcommand === AtlasCommands.PULL) {
    process.exit(await pull());
  }

  await serve();
};

main().catch((error: unknown) => {
  console.error(`${AtlasConstants.SERVER_NAME}: ${messageOf(error)}`);
  process.exit(1);
});
