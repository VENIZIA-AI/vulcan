import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ShellParser } from '../../hooks/index.ts';
import { BASH_CASES } from './shell-bash-corpus.ts';

const BASH = '/bin/bash';

/** Every program the parser lists for a line, the commands `env -S` makes included. */
const programsOf = (line: string): { programs: Set<string>; isFlagged: boolean } => {
  const parsed = ShellParser.parseChecked({ command: line });
  const programs = new Set<string>();

  for (const command of parsed.commands) {
    const program = ShellParser.programOf({ command });

    programs.add(program.name);

    for (const words of program.splitCommands) {
      programs.add(
        ShellParser.programOf({ command: { words, redirects: [], assignments: [] } }).name,
      );
    }
  }

  return {
    programs,
    isFlagged: parsed.isOverBudget || parsed.isUncertain || parsed.hasUnknownProgram,
  };
};

/**
 * The programs a real bash runs for `line`, nothing on the PATH, each logged to a file instead of run. A file,
 * not a pipe: a process substitution or a coprocess can still be writing when the shell exits.
 */
const ranByBash = (opts: { line: string; folder: string; index: number }): string[] => {
  const log = join(opts.folder, `${opts.index}.log`);
  const prelude = `command_not_found_handle() { printf "%s\\n" "$1" >>"$RAN"; return 0; }\ntrap wait EXIT`;

  Bun.spawnSync([BASH, '--norc', '--noprofile', '-c', `${prelude}\n${opts.line}`], {
    env: { PATH: '/nonexistent', LC_ALL: 'C', RAN: log },
    cwd: opts.folder,
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
    timeout: 5000,
  });

  // What runs in the background has a moment to finish.
  if (/[<>]\(|coproc|&/.test(opts.line)) {
    Bun.sleepSync(100);
  }

  const ran = existsSync(log)
    ? readFileSync(log, 'utf8')
        .split('\n')
        .filter((name) => name !== '')
    : [];

  return [...new Set(ran)].sort();
};

describe('the parser lists every program bash runs, or flags the line', () => {
  test.each(BASH_CASES)('$line', ({ line, ran }) => {
    const { programs, isFlagged } = programsOf(line);

    expect(isFlagged || ran.every((name) => programs.has(name))).toBe(true);
  });

  test.skipIf(!existsSync(BASH))(
    'the recorded programs are what this bash runs',
    () => {
      const folder = mkdtempSync(join(tmpdir(), 'shell-bash-'));
      const differ = BASH_CASES.map(({ line, ran }, index) => ({
        line,
        ran,
        actual: ranByBash({ line, folder, index }),
      })).filter(({ ran, actual }) => JSON.stringify(actual) !== JSON.stringify(ran));

      rmSync(folder, { recursive: true, force: true });

      expect(differ).toEqual([]);
    },
    60_000,
  );
});
