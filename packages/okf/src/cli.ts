#!/usr/bin/env bun
/**
 * vulcan-okf - one entry for the knowledge-bundle tooling. `run.ts` runs as a child process, so it
 * reads its own `process.argv`.
 */
import { join } from 'node:path';
import { ConstClass } from './common/types.ts';

class OkfCommands extends ConstClass {
  static readonly CHECK = 'check';
  static readonly GEN = 'gen';
  static readonly COVERAGE = 'coverage';
}

const USAGE = 'usage: vulcan okf <check|gen|coverage>';

const [command, ...rest] = process.argv.slice(2);

if (command === undefined || !OkfCommands.isValid(command)) {
  console.error(USAGE);
  process.exit(2);
}

const child = Bun.spawn([process.execPath, join(import.meta.dir, 'run.ts'), command, ...rest], {
  stdio: ['inherit', 'inherit', 'inherit'],
});

const exitCode = await child.exited;

process.exit(exitCode);
