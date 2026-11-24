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

  test('the opt-out needs a comment with a reason, and every line that uses it is listed here', () => {
    expect(scan("const a = [bin, 'doctor']; // retired-form: because")).toEqual([]);
    expect(scan("const a = [bin, 'doctor']; // retired-form:")).toHaveLength(1);
    expect(scan("const a = [bin, 'doctor']; retired-form: because")).toHaveLength(1);
    expect(scan("const a = ['vulcan', 'x', 'atlas'];")).toHaveLength(1);
    expect(scan('"vulcan","sync"')).toHaveLength(1);
    expect(scan('"args": ["x", "atlas", "mcp"]')).toHaveLength(1);
    expect(scan('[bin, VulcanCommands.SYNC]')).toHaveLength(1);

    // A new use fails here until it is listed: each is a place that must keep an old form (an entry an earlier release wrote, the old spelling a doctor reads, the bin an upgrade installs).
    expect(CommandForms.allowedUses({ files: CommandForms.tracked() })).toEqual({
      'packages/cli/src/__tests__/agents/render.test.ts': 4,
      'packages/cli/src/__tests__/doctor/prepare-script.test.ts': 1,
      'packages/cli/src/__tests__/doctor/runner.test.ts': 1,
      'packages/cli/src/__tests__/sync/agents-blocks.test.ts': 1,
      'packages/cli/src/__tests__/sync/mcp-json.test.ts': 2,
      'packages/cli/src/agents/render.ts': 2,
      'packages/cli/src/commands/upgrade.command.ts': 1,
      'packages/cli/src/doctor/checks.ts': 2,
    });
  });
});
