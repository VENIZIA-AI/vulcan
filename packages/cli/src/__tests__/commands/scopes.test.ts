import { describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { CommandScopes } from '../../commands/scopes.ts';
import { CommandTable } from '../../commands/table.ts';
import { runCli } from '../helpers/run.helper.ts';

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

/** The actions the help lists for each scope: the table's, those a handler keeps for itself, and a tool's command. */
const listed = (scope: string): string[] => {
  const native: Record<string, string[]> = {
    migrate: ['plan', 'apply'],
    profile: ['edit', 'show', 'reset'],
    okf: ['<command>'],
    atlas: ['<command>'],
  };
  // `event step` is `flow step` under its older words: the help of `flow step` says so.
  const actions = CommandScopes.actionsOf({ scope }).filter(
    (action) => !(scope === 'event' && action === 'step'),
  );

  return [...new Set([...actions, ...(native[scope] ?? [])])];
};

/** The `scope action` of every usage line of a help text: the lines that start two spaces in. */
const usageLines = (text: string): string[] =>
  text
    .split('\n')
    .filter((line) => /^ {2}\S/.test(line))
    .map((line) => /^ {2}vulcan (\S+ \S+)/.exec(line)?.[1] ?? line);

describe('the help', () => {
  const all = CommandScopes.scopes().flatMap((scope) =>
    listed(scope).map((action) => `${scope} ${action}`),
  );

  test('every usage line is `vulcan <scope> <action>` of a public command, and every one has a line', () => {
    expect([...new Set(usageLines(CommandTable.helpText()))].sort()).toEqual([...all].sort());
  });

  test('no line is longer than 100 columns', () => {
    const long = CommandTable.helpText()
      .split('\n')
      .filter((line) => line.length > 100);

    expect(long).toEqual([]);
  });

  test('the scopes come grouped, in the order of the scope table', () => {
    const order = usageLines(CommandTable.helpText()).map((line) => line.split(' ')[0]);

    expect([...new Set(order)]).toEqual(CommandScopes.scopes());
    expect(order).toEqual(
      [...order].sort(
        (left, right) =>
          CommandScopes.scopes().indexOf(left) - CommandScopes.scopes().indexOf(right),
      ),
    );
  });

  test('the help of a scope lists its own actions, all of them, and no other', () => {
    for (const scope of CommandScopes.scopes()) {
      const lines = usageLines(CommandTable.scopeHelp({ scope }));

      expect([...new Set(lines)].sort(), scope).toEqual(
        listed(scope)
          .map((action) => `${scope} ${action}`)
          .sort(),
      );
    }
  });
});

describe('help of a scope', () => {
  test('`help <scope>` prints that scope, an unknown one exits 2, and a bare flow, event or migrate shows its scope', () => {
    const of = (args: string[]) => runCli({ args, cwd: tmpdir() });
    const board = of(['help', 'board']);
    const unknown = of(['help', 'nosuch']);

    expect(board.code).toBe(0);
    expect(board.stdout).toBe(CommandTable.scopeHelp({ scope: 'board' }));
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain("no scope 'nosuch'");

    for (const scope of ['flow', 'event', 'migrate']) {
      const bare = of([scope]);

      expect(bare.code, scope).toBe(2);
      expect(bare.stderr, scope).toBe(CommandTable.scopeHelp({ scope }));
    }
  });

  test("`--help` and `-h` after a scope print that scope's usage and exit 0; okf and atlas keep passing the flag to the tool", () => {
    for (const scope of CommandScopes.scopes().filter((name) => !['okf', 'atlas'].includes(name))) {
      for (const flag of ['--help', '-h']) {
        const result = runCli({ args: [scope, flag], cwd: tmpdir() });

        expect(result.code, `${scope} ${flag}`).toBe(0);
        expect(result.stdout, `${scope} ${flag}`).toBe(CommandTable.scopeHelp({ scope }));
        expect(result.stdout, `${scope} ${flag}`).toContain(`  vulcan ${scope} `);
      }
    }
  });
});
