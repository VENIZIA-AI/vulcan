#!/usr/bin/env bun
/**
 * vulcan-okf - one entry for the knowledge-bundle tooling. `run.ts` runs as a child process, so it
 * reads its own `process.argv`.
 */
import { join } from 'node:path';

class OkfCommands {
  static readonly CHECK = 'check';
  static readonly GEN = 'gen';
  static readonly COVERAGE = 'coverage';
  static readonly VIZ = 'viz';
  static readonly SCHEME_SET = new Set<string>([this.CHECK, this.GEN, this.COVERAGE, this.VIZ]);
  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

const USAGE = 'usage: vulcan x okf <check|gen|coverage|viz>';

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
