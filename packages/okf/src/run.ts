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

// Runs only as the entry `cli.ts` spawns; importing the module (tests) has no side effect.
if (import.meta.main) {
  const command = process.argv[2];

  switch (command) {
    case 'gen': {
      gen();
      break;
    }

    case 'check': {
      check({ strict: process.argv.includes('--strict') });
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
}
