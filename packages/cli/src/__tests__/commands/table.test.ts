import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COMMAND_LOADERS } from '../../commands/index.ts';
import { CommandTable } from '../../commands/table.ts';
import { runCli } from '../run.helper.ts';

const FLAG_IN_TEXT = /--[a-z][a-z-]*/g;
/** Words of a help block that look like flags and are not this command's: the help flag itself. */
const NOT_A_FLAG = new Set(['--help']);

const entries = Object.entries(CommandTable.COMMANDS);

describe('CommandTable: help, the parser and the generated reference read one table', () => {
  test('every command with a loader has an entry, and no entry is without a loader', () => {
    expect(Object.keys(CommandTable.COMMANDS).sort()).toEqual(Object.keys(COMMAND_LOADERS).sort());
  });

  test('a flag the parser accepts is in the help block of its command, and the other way round', () => {
    for (const [name, spec] of entries) {
      const accepted = new Set([
        ...Object.keys(spec.flags ?? {}),
        ...Object.keys(spec.values ?? {}),
      ]);
      const named = new Set(
        (spec.help.match(FLAG_IN_TEXT) ?? []).filter((flag) => !NOT_A_FLAG.has(flag)),
      );

      expect([...named].sort(), `${name}: flags in the help block`).toEqual([...accepted].sort());
    }
  });

  test('every flag has a description and every command says what its exit codes mean', () => {
    for (const [name, spec] of entries) {
      for (const [flag, description] of Object.entries({ ...spec.flags, ...spec.values })) {
        expect(description.trim(), `${name} ${flag}`).not.toBe('');
      }

      expect(spec.exits.trim(), `${name} exits`).not.toBe('');
    }
  });

  test('help prints the block of every command, in table order, under the version line', () => {
    const result = runCli({ args: ['help'], cwd: tmpdir() });
    let from = 0;

    expect(result.code).toBe(0);
    expect(result.stdout.startsWith('vulcan ')).toBe(true);

    for (const [name, spec] of entries) {
      if (spec.help === '') {
        continue;
      }

      const at = result.stdout.indexOf(spec.help, from);

      expect(at, `${name} block, in order`).toBeGreaterThanOrEqual(from);
      from = at + spec.help.length;
    }
  });

  test('the router takes its arguments from the table', () => {
    expect(CommandTable.accepted({ name: 'board' })?.values).toContain('--port');
    expect(CommandTable.accepted({ name: 'x' })).toBeUndefined();
    expect(CommandTable.accepted({ name: 'commit-check' })?.unknownExit).toBe(2);
  });

  test('the help block of the commands page is the help text, but for the version line', () => {
    const page = readFileSync(
      join(import.meta.dir, '../../../../../docs/wiki/content/references/commands/index.md'),
      'utf8',
    );
    const start = page.indexOf('```text\nvulcan ');
    const block = page.slice(start, page.indexOf('\n```', start + 5));

    expect(start).toBeGreaterThan(-1);
    expect(block.split('\n').slice(2).join('\n')).toBe(
      CommandTable.helpText().trimEnd().split('\n').slice(1).join('\n'),
    );
  });

  test('a flag a command lets through and does not read stays accepted, and is not in its help', () => {
    const init = CommandTable.accepted({ name: 'init' });

    expect(init?.flags).toContain('--no-api');
    expect(init?.values).toContain('--api');
    expect(CommandTable.COMMANDS.init.help).not.toContain('--api');
  });
});
