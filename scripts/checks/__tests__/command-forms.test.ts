import { describe, expect, test } from 'bun:test';
import { CommandForms } from '../command-forms.ts';

const scan = (text: string, file = 'docs/a.md') => CommandForms.scan({ files: [{ file, text }] });

describe('the retired command forms', () => {
  test.each([
    'run `bun node_modules/.bin/vulcan sync` first',
    'vulcan doctor',
    'vulcan init --preset p',
    'vulcan x atlas mcp',
    'vulcan commit-check "$1"',
    'vulcan board --open',
    'vulcan config --effective',
    'vulcan event step --flow X',
    'vulcan event add --kind flow --title t',
    '`${ProjectLayout.VULCAN_COMMAND} sync`',
    "[bin, 'doctor'],",
    "[bin, 'x', 'okf', 'check', '--strict'],",
    "args: [join(root, 'node_modules', '.bin', 'vulcan'), 'sync'],",
  ])('%s is found', (text) => {
    expect(scan(text)).toHaveLength(1);
  });

  test.each([
    'vulcan project sync',
    'vulcan board show --open',
    'vulcan board serve',
    'vulcan atlas mcp',
    'vulcan event add --kind commit',
    'vulcan event tail',
    'vulcan flow step --flow X',
    'vulcan migrate notes',
    'vulcan check commit',
    'vulcan config effective',
    "[bin, 'project', 'doctor'],",
    "[bin, 'okf', 'check', '--strict'],",
    "['add', '-d', '--exact', 'x']",
  ])('%s is the new form and is not', (text) => {
    expect(scan(text)).toEqual([]);
  });

  test('the table, its tests, the frozen history and the tracked repository say it only where it belongs', () => {
    expect(scan('vulcan sync', 'packages/cli/src/commands/scopes.ts')).toEqual([]);
    expect(scan('vulcan sync', 'docs/wiki/content/changelogs/2026-10-17-x.md')).toEqual([]);
    expect(CommandForms.scan({ files: CommandForms.tracked() })).toEqual([]);
  });

  test('a hit names the file, the line and the text', () => {
    expect(scan('fine\nrun vulcan upgrade now')).toEqual([
      { file: 'docs/a.md', line: 2, text: 'run vulcan upgrade now' },
    ]);
  });
});
