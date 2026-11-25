import { describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { CommandScopes } from '../../commands/scopes.ts';
import { CommandTable } from '../../commands/table.ts';
import { runCli } from '../run.helper.ts';

/** Every old form and the argv of the handler that answers its replacement: one row per pair, so a change of a name is deliberate. */
const PAIRS: { old: string; now: string; run: string[] }[] = [
  { old: 'init', now: 'project init', run: ['init'] },
  { old: 'sync', now: 'project sync', run: ['sync'] },
  { old: 'doctor', now: 'project doctor', run: ['doctor'] },
  { old: 'upgrade', now: 'project upgrade', run: ['upgrade'] },
  { old: 'clean', now: 'project clean', run: ['clean'] },
  { old: 'add', now: 'package add', run: ['add'] },
  { old: 'preset diff', now: 'package diff', run: ['preset', 'diff'] },
  { old: 'agents list', now: 'agent list', run: ['agents', 'list'] },
  { old: 'agents setup', now: 'agent setup', run: ['agents', 'setup'] },
  { old: 'config --effective', now: 'config effective', run: ['config', '--effective'] },
  { old: 'config --diff', now: 'config diff', run: ['config', '--diff'] },
  { old: 'commit-check', now: 'check commit', run: ['commit-check'] },
  { old: 'layout check', now: 'check layout', run: ['layout', 'check'] },
  { old: 'config format', now: 'config format', run: ['config', 'format'] },
  { old: 'runners check', now: 'check runners', run: ['runners', 'check'] },
  { old: 'changelog check', now: 'check changelog', run: ['changelog', 'check'] },
  { old: 'changelog notes', now: 'migrate notes', run: ['changelog', 'notes'] },
  { old: 'event add --type flow', now: 'flow add', run: ['event', 'add', '--type', 'flow'] },
  { old: 'event step', now: 'flow step', run: ['event', 'step'] },
  { old: 'event add', now: 'event add', run: ['event', 'add'] },
  { old: 'event tail', now: 'event tail', run: ['event', 'tail'] },
  { old: 'board', now: 'board show', run: ['board'] },
  { old: 'board serve', now: 'board serve', run: ['board', 'serve'] },
  { old: 'visualize', now: 'page new', run: ['visualize'] },
  { old: 'visualize --schema', now: 'page schema', run: ['visualize', '--schema'] },
];

const resolved = (argv: string[]): string[] | undefined => {
  const result = CommandScopes.resolve({ argv });

  return result?.type === 'run' ? result.argv : undefined;
};

describe('the scopes of the command line', () => {
  test.each(PAIRS)('$now runs the handler of the old $old', ({ now, run }) => {
    const [scope, action, ...rest] = now.split(' ');
    const argv = resolved([scope, action, '--x']);

    // A handler's own first words, then what the caller typed after the action.
    expect(argv?.slice(0, run.length)).toEqual(run);
    expect(argv?.at(-1)).toBe('--x');
    expect(rest).toEqual([]);
  });

  test('okf and atlas hand everything to the tool, `x` still does for one release', () => {
    expect(resolved(['atlas', 'mcp', '--root', '.'])).toEqual(['x', 'atlas', 'mcp', '--root', '.']);
    expect(resolved(['okf', 'check', '--strict'])).toEqual(['x', 'okf', 'check', '--strict']);
    expect(resolved(['atlas'])).toEqual(['x', 'atlas']);
  });

  test('profile and migrate keep their own words; migrate notes is the only new action', () => {
    expect(CommandScopes.resolve({ argv: ['profile', 'show'] })).toBeUndefined();
    expect(CommandScopes.resolve({ argv: ['migrate', 'plan', '--to', '1'] })).toBeUndefined();
    expect(resolved(['migrate', 'notes', '--version', '1.0.0'])).toEqual([
      'changelog',
      'notes',
      '--version',
      '1.0.0',
    ]);
  });

  test('a scope with no action, or an unknown one, is refused with the choices', () => {
    for (const argv of [['project'], ['project', 'frobnicate'], ['check', 'nope'], ['board']]) {
      const result = CommandScopes.resolve({ argv });

      expect(result?.type, argv.join(' ')).toBe('refused');
      expect(result?.type === 'refused' ? result.message : '').toContain('one of:');
    }
  });

  test('every handler of the table is reached through some scope, and nothing else is public', () => {
    const reached = new Set(CommandScopes.COMMANDS.map((entry) => entry.command));

    for (const name of Object.keys(CommandTable.COMMANDS)) {
      const isPublic = ['profile', 'migrate', 'help', 'version', 'x'].includes(name);

      expect(isPublic || reached.has(name), name).toBe(true);
    }
  });
});

describe('the old names', () => {
  test('sync, commit-check and x still run in this release, with a notice that names the new form', () => {
    for (const name of ['sync', 'commit-check', 'x']) {
      const result = CommandScopes.resolve({ argv: [name] });

      expect(result?.type, name).toBe('forwarded');
      expect(result?.type === 'forwarded' ? result.notice : '', name).toContain(
        `vulcan ${name} is now vulcan `,
      );
    }
  });

  test('every other old name is refused with exit 2 and says what to type', () => {
    for (const name of [
      'init',
      'doctor',
      'upgrade',
      'clean',
      'add',
      'preset',
      'agents',
      'runners',
      'changelog',
      'visualize',
    ]) {
      const result = CommandScopes.resolve({ argv: [name] });

      expect(result?.type, name).toBe('refused');
      expect(result?.type === 'refused' ? result.exit : 0, name).toBe(2);
    }
  });

  test('the router prints the new form on stderr and exits 2 for a refused name', () => {
    const result = runCli({ args: ['doctor'], cwd: tmpdir() });

    expect(result.code).toBe(2);
    expect(result.stderr).toBe('vulcan doctor is now vulcan project doctor\n');
    expect(result.stdout).toBe('');
  });

  test('the forwarded names are the only ones that still work: removing the forwarding is deliberate', () => {
    expect(
      Object.entries(CommandScopes.RETIRED)
        .filter(([, entry]) => entry.forwards === true)
        .map(([name]) => name)
        .sort(),
    ).toEqual(['commit-check', 'sync', 'x']);
  });
});

describe('the help names only the public commands', () => {
  test('every usage line of the help starts with a scope, `help` or `version`', () => {
    const known = new Set([...CommandScopes.scopes(), 'help', 'version']);
    // A usage line has two spaces and a word; its continuation lines have more spaces.
    const first = CommandTable.helpText()
      .split('\n')
      .flatMap((line) => (/^ {2}[a-z]/.test(line) ? [/^ {2}([a-z-]+)/.exec(line)?.[1] ?? ''] : []));

    expect(first.filter((word) => !known.has(word))).toEqual([]);
  });
});

describe('help of a scope', () => {
  test("`--help` and `-h` after a scope print that scope's usage and exit 0; okf and atlas keep passing the flag to the tool", () => {
    for (const [scope, flag] of [
      ['project', '--help'],
      ['check', '-h'],
      ['board', '--help'],
      ['profile', '-h'],
    ]) {
      const result = runCli({ args: [scope, flag], cwd: tmpdir() });

      expect(result.code, `${scope} ${flag}`).toBe(0);
      expect(result.stdout, `${scope} ${flag}`).toContain(`  ${scope}`);
      expect(result.stdout).not.toContain('Usage: bun node_modules/.bin/vulcan <command>');
    }

    expect(runCli({ args: ['project', '--help'], cwd: tmpdir() }).stdout).not.toContain(
      '  board show',
    );
    expect(CommandTable.scopeHelp({ scope: 'agent' })).toContain('  agent [list|add');
  });
});
