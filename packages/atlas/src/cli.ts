#!/usr/bin/env bun
import { AtlasCommands, AtlasConstants } from './common';
import type { TAtlasMode } from './common';
import {
  findPackageDirectory,
  ModeUsageError,
  readPackageVersion,
  readRootArgument,
  resolveMode,
} from './cli/index';
import { runReleasesCommand } from './releases/generator';
import { buildServer } from './server';
import { runSurfaceCommand } from './surface/index';
import { runSymbolsCommand } from './symbols/generator';

const USAGE = `usage: ${AtlasConstants.SERVER_NAME} [mcp] [--root <dir>] | <surface|symbols|releases> <gen|check>`;

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

const { mode, root, version } = resolveServerOptions({ argv });

try {
  buildServer({ mode, root, version })
    .run()
    .catch((error: unknown) => {
      console.error(`${AtlasConstants.SERVER_NAME}: ${messageOf(error)}`);
      process.exit(1);
    });
} catch (error) {
  console.error(`${AtlasConstants.SERVER_NAME}: ${messageOf(error)}`);
  process.exit(1);
}
