#!/usr/bin/env bun
/**
 * The okf command runner: `cli.ts` spawns it with `gen | check [--strict] | coverage | viz`.
 *
 * Source-derived content is either a whole generated file (reference/*) or lives inside a managed
 * region delimited by `<!-- okf:generated:<id> start -->` and `<!-- okf:generated:<id> end -->`.
 * Everything else in the bundle is hand-authored and never touched. Project-specific
 * configuration lives in ./config.ts.
 */
import { check } from './check/index.ts';
import { coverage } from './coverage-report/index.ts';
import { gen } from './generate/index.ts';
import { buildViz } from './viz/index.ts';

/** A project the user must fix (no config, a bad renderer module): its message, never a stack. */
const isProjectError = (opts: { error: unknown }): opts is { error: Error } =>
  opts.error instanceof Error && opts.error.message.startsWith('okf: ');

const runCommand = async (opts: { command: string | undefined; argv: string[] }): Promise<void> => {
  switch (opts.command) {
    case 'gen': {
      gen();
      break;
    }

    case 'check': {
      check({ strict: opts.argv.includes('--strict') });
      break;
    }

    case 'coverage': {
      coverage();
      break;
    }

    case 'viz': {
      await buildViz();
      break;
    }

    default: {
      console.error('usage: vulcan x okf <check|gen|coverage|viz>');
      process.exit(2);
    }
  }
};

// Runs only as the entry `cli.ts` spawns; importing the module (tests) has no side effect.
if (import.meta.main) {
  try {
    await runCommand({ command: process.argv[2], argv: process.argv });
  } catch (error) {
    const caught = { error };

    if (!isProjectError(caught)) {
      throw error;
    }

    console.error(caught.error.message);
    process.exit(1);
  }
}
