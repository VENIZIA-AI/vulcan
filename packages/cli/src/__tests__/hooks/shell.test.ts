import { describe, expect, test } from 'bun:test';
import {
  parseShell,
  parseShellChecked,
  programOf,
  ShellBudget,
  splitEnvString,
} from '../../hooks/index.ts';

const wordsOf = (command: string): string[][] =>
  parseShell({ command }).map((simple) => simple.words);

describe('parseShell', () => {
  test('splits on ;, &&, ||, | and newlines', () => {
    expect(wordsOf('a 1 && b 2; c | d\ne')).toEqual([['a', '1'], ['b', '2'], ['c'], ['d'], ['e']]);
  });

  test('quotes keep a word whole and an operator inside quotes splits nothing', () => {
    expect(wordsOf(`git commit -m "fix: a; b && c" 'x y'`)).toEqual([
      ['git', 'commit', '-m', 'fix: a; b && c', 'x y'],
    ]);
  });

  test('redirects are collected, descriptor duplicates are not', () => {
    const [command] = parseShell({ command: 'echo hi > out.txt 2>&1 >> log.txt' });

    expect(command?.words).toEqual(['echo', 'hi']);
    expect(command?.redirects).toEqual(['out.txt', 'log.txt']);
  });

  test('&> and 2> name files too', () => {
    const [command] = parseShell({ command: 'run &> all.log 2>err.log' });

    expect(command?.redirects).toEqual(['all.log', 'err.log']);
  });

  test('leading NAME=value words are assignments, not the program', () => {
    const [command] = parseShell({ command: 'TMPDIR=/tmp FOO=1 mktemp' });

    expect(command?.assignments).toEqual(['TMPDIR=/tmp', 'FOO=1']);
    expect(command?.words).toEqual(['mktemp']);
  });

  test('$(...), backticks and sh -c are parsed as commands too', () => {
    expect(wordsOf('echo $(git branch -D x)').some((words) => words[0] === 'git')).toBe(true);
    expect(wordsOf('echo `mkdir /x`').some((words) => words[0] === 'mkdir')).toBe(true);
    expect(wordsOf(`bash -c 'git reset --hard'`).some((words) => words[0] === 'git')).toBe(true);
  });

  test('a single-quoted $( is text, not a substitution', () => {
    expect(wordsOf(`echo '$(rm -rf x)'`)).toEqual([['echo', '$(rm -rf x)']]);
  });

  // An option letter means a different thing for each wrapper: a switch must never swallow the program.
  test.each([
    // sudo: -E -n -S -H -i are switches, -u -g -R take a value, a cluster ends in its value, `--` ends options
    'sudo -E git status',
    'sudo -n git status',
    'sudo -S git status',
    'sudo -H git status',
    'sudo -E -n -H git status',
    'sudo -u root git status',
    'sudo -nu root git status',
    'sudo -Eu root git status',
    'sudo -uroot git status',
    'sudo -g adm git status',
    'sudo -R /srv git status',
    'sudo --user root git status',
    'sudo --user=root git status',
    'sudo --preserve-env git status',
    'sudo -- git status',
    'sudo FOO=1 git status',
    // doas
    'doas git status',
    'doas -u root git status',
    'doas -n git status',
    // env: -i -0 -v are switches, -u -C -S -a take a value
    'env -i git status',
    'env -0 git status',
    'env -u HOME git status',
    'env --unset HOME git status',
    'env --unset=HOME git status',
    'env -C /srv git status',
    'env -i FOO=1 git status',
    'env -a name git status',
    'env -f vars.env git status',
    'env --file vars.env git status',
    // nice: -n takes a value, -5 is the value itself
    'nice -n 5 git status',
    'nice -5 git status',
    'nice --adjustment 5 git status',
    'nice --adjustment=5 git status',
    'ionice -c 3 git status',
    'ionice -c3 git status',
    'ionice -P 1 git status',
    'ionice --class 3 git status',
    // nohup, setsid, exec, command, time
    'nohup git status',
    'setsid git status',
    'exec git status',
    'exec -a name git status',
    'exec -c git status',
    'command git status',
    'command -p git status',
    'time git status',
    'time -p git status',
    '/usr/bin/time -f %e -o out git status',
    '/usr/bin/time -a git status',
    // timeout takes a duration as a plain word
    'timeout 5 git status',
    'timeout -k 3 10 git status',
    'timeout --signal TERM 5 git status',
    'timeout --signal=TERM 5 git status',
    'timeout --preserve-status 5 git status',
    'timeout 1m git status',
    // watch, stdbuf, xargs
    'watch -n 2 git status',
    'watch -d git status',
    'watch --interval 2 git status',
    'watch -q 2 git status',
    'watch --equexit 2 git status',
    'stdbuf -oL git status',
    'stdbuf -o L git status',
    'xargs -0 git status',
    'xargs -n 1 git status',
    'xargs -n1 git status',
    'xargs -0 -n 1 git status',
    'xargs -I {} git status',
    'xargs -E eof git status',
    'xargs -r git status',
    'xargs --process-slot-var SLOT git status',
    'xargs --arg-file list git status',
    // wrappers inside wrappers
    'sudo -E env -i nice -n 5 timeout 5 git status',
  ])('programOf reads past the options of the wrappers in %s', (command) => {
    const [simple] = parseShell({ command });

    expect(programOf({ command: simple! }).name).toBe('git');
    expect(programOf({ command: simple! }).args).toEqual(['status']);
  });

  test('an option whose value is the next word: the value is not taken for the program', () => {
    const [simple] = parseShell({ command: 'xargs -n 1 -I {} sudo -u root git log' });

    expect(programOf({ command: simple! }).name).toBe('git');
  });

  test('programOf skips wrappers and flags before the program', () => {
    const [command] = parseShell({ command: 'sudo -n env git status' });

    expect(programOf({ command: command! })).toEqual({
      name: 'git',
      index: 3,
      args: ['status'],
      splitCommands: [],
    });
  });

  // `env -S` holds a whole command line in one word: it is parsed like `sh -c`.
  test.each([
    'env -S "git push -f origin main"',
    "env -S 'git push -f origin main'",
    "env -S'git push -f origin main'",
    'env -iS "git push -f origin main"',
    'env -i -S "git push -f origin main"',
    'env --split-string="git push -f origin main"',
    'env --split-string "git push -f origin main"',
    'sudo env -S "git push -f origin main"',
    'sudo -E env -i -S "git push -f origin main"',
    'timeout 5 env -S "git push -f origin main"',
    'FOO=1 env -S "git push -f origin main"',
    'env -S "git push" -f origin main',
    'env -S "env -S \'git push -f origin main\'"',
    'env -S "bash -c \'git push -f origin main\'"',
  ])('the command line in %s is read as commands', (command) => {
    expect(
      parseShell({ command }).some(
        (simple) => programOf({ command: simple }).name === 'git' && simple.words.includes('-f'),
      ),
    ).toBe(true);
  });

  test.each([
    'echo env -S "git push -f origin main"',
    'git commit -m "env -S git push -f origin main"',
    'env -S',
    'env -S ""',
    'env -uS "git push -f origin main"',
    'ls -S "git push -f origin main"',
    'sudo -S git status',
  ])('%s does not make a git push', (command) => {
    expect(
      parseShell({ command }).some(
        (simple) => programOf({ command: simple }).name === 'git' && simple.words.includes('-f'),
      ),
    ).toBe(false);
  });

  const isForcePush = (command: string): boolean =>
    parseShell({ command }).some(
      (simple) => programOf({ command: simple }).name === 'git' && simple.words.includes('-f'),
    );

  // GNU getopt accepts any unique prefix of a long option; only --split-string starts with an s.
  test.each([
    'env --split "git push -f origin main"',
    'env --split="git push -f origin main"',
    'env --split-s "git push -f origin main"',
    'env --s="git push -f origin main"',
    'env --split-string "git push -f origin main"',
  ])('the abbreviated long option in %s is read', (command) => {
    expect(isForcePush(command)).toBe(true);
  });

  test('other long options are shortened the same way when they take a value', () => {
    const [simple] = parseShell({ command: 'nice --adj 5 git status' });

    expect(programOf({ command: simple! }).name).toBe('git');
  });

  // env reads its own options again inside the value.
  test.each([
    'env -S "-u X git push -f origin main"',
    'env -S "-C . git push -f origin main"',
    'env -S "-i -u X git push -f origin main"',
    'env -S "-S \'git push -f origin main\'"',
    'env -S "--split-string=\'git push -f origin main\'"',
    'env -S "--split \'git push -f origin main\'"',
  ])('the options inside the value of %s are read', (command) => {
    expect(isForcePush(command)).toBe(true);
  });

  // env's own escapes, not the shell's.
  test.each([
    "env -S 'git\\_push\\_-f\\_origin\\_main'",
    'env -S "git push -f origin main\\c trailing"',
    'env -S "git push -f \'origin main\'"',
  ])('the escapes in %s are env escapes', (command) => {
    expect(isForcePush(command)).toBe(true);
  });

  test.each([
    'env -S "echo a;git push -f origin main"',
    'env -S "echo a|git push -f origin main"',
    'env -S "echo \\$(git push -f origin main)"',
    'env -S "echo # git push -f origin main"',
    'env -- -S "git push -f origin main"',
    'env -S "echo git push -f origin main"',
    'env -S "git\\tpush -f origin main"',
  ])('%s makes no git push: env does not read these as a shell does', (command) => {
    expect(isForcePush(command)).toBe(false);
  });

  // ANSI-C quoting: the shell reads $'...' as the same words.
  test.each([
    "$'git' push -f origin main",
    "env -S $'git push -f origin main'",
    "sh -c $'git push -f origin main'",
    "$'\\x67it' push -f origin main",
    "$'\\147it' push -f origin main",
    "$'\\u0067it' push -f origin main",
    "$'g\\x69t' push -f origin main",
    'git$"" push -f origin main',
    '$"git" push -f origin main',
    "sudo $'git' push -f origin main",
    "bash -c $'git push -f origin main'",
  ])('%s is a git push', (command) => {
    expect(isForcePush(command)).toBe(true);
  });

  test.each([
    "echo $'git push -f origin main'",
    "git commit -m $'git push -f origin main'",
    "$'git\\x20push' -f origin main",
    "$'git\\npush' -f origin main",
    "echo '$'\"'\"'git push -f'",
    'echo "$\'git push -f origin main\'"',
  ])('%s is not a git push', (command) => {
    expect(isForcePush(command)).toBe(false);
  });

  test("the escapes of $'...' are decoded", () => {
    const firstWords = (command: string): string[] => parseShell({ command })[0]?.words ?? [];

    expect(firstWords("echo $'a\\nb\\tc'")).toEqual(['echo', 'a\nb\tc']);
    expect(firstWords("echo $'\\x41\\101\\u0041\\U00000041'")).toEqual(['echo', 'AAAA']);
    expect(firstWords("echo $'a\\'b'")).toEqual(['echo', "a'b"]);
    expect(firstWords("echo $'a\\\\b'")).toEqual(['echo', 'a\\b']);
    expect(firstWords("echo $'\\q'")).toEqual(['echo', '\\q']);
    expect(firstWords("echo $'a\\0b'")).toEqual(['echo', 'a']);
    expect(firstWords("echo $'a\\x00b'c")).toEqual(['echo', 'ac']);
    expect(firstWords("echo $'\\cA'")).toEqual(['echo', '\x01']);
    expect(firstWords("echo $'abc")).toEqual(['echo', 'abc']);
    expect(firstWords("echo $'a'$'b' 'c'")).toEqual(['echo', 'ab', 'c']);
    expect(firstWords("echo $'\\xZZ'")).toEqual(['echo', '\\xZZ']);
    expect(firstWords("echo $'\\U7fffffff'")).toEqual(['echo', '']);
    // `\c` takes the character after it, or stays when the quote closes right behind it; `\c\\` takes both backslashes.
    expect(firstWords(String.raw`echo $'\c'`)).toEqual(['echo', String.raw`\c`]);
    expect(firstWords(String.raw`echo $'\c\\'`)).toEqual(['echo', '\x1c']);
    expect(firstWords(String.raw`echo $'\c?' x`)).toEqual(['echo', '\x7f', 'x']);
    expect(firstWords(String.raw`echo $'a\c'b`)).toEqual(['echo', String.raw`a\cb`]);
    // Inside single or double quotes the `$` is just a character.
    expect(firstWords("echo '$'x")).toEqual(['echo', '$x']);
    expect(firstWords('echo "$\'x\'"')).toEqual(['echo', "$'x'"]);
  });

  test('splitEnvString splits by env rules', () => {
    expect(splitEnvString({ value: 'a b  c' })).toEqual(['a', 'b', 'c']);
    expect(splitEnvString({ value: 'a \'b c\' "d e"' })).toEqual(['a', 'b c', 'd e']);
    expect(splitEnvString({ value: 'a\\_b' })).toEqual(['a', 'b']);
    expect(splitEnvString({ value: '"a\\_b"' })).toEqual(['a b']);
    expect(splitEnvString({ value: 'a\\cb c' })).toEqual(['a']);
    expect(splitEnvString({ value: 'a # comment' })).toEqual(['a']);
    expect(splitEnvString({ value: 'a#b' })).toEqual(['a#b']);
    expect(splitEnvString({ value: "'a\\'b' c" })).toEqual(["a'b", 'c']);
    expect(splitEnvString({ value: "'a\\nb'" })).toEqual(['a\\nb']);
    expect(splitEnvString({ value: 'a\\nb' })).toEqual(['a\nb']);
    expect(splitEnvString({ value: '' })).toEqual([]);
    expect(splitEnvString({ value: '""' })).toEqual(['']);
    expect(splitEnvString({ value: 'a;b|c $(d)' })).toEqual(['a;b|c', '$(d)']);
  });

  // The cost of a line is linear in its length, whatever it repeats; what is not read is said.
  test.each([20, 80, 110, 400])(
    'env then -S env x%i then a push is parsed fast, and is read or flagged',
    (count) => {
      const command = `env${' -S env'.repeat(count)} git push -f origin main`;
      const started = performance.now();
      const parsed = parseShellChecked({ command });

      expect(performance.now() - started).toBeLessThan(1000);
      expect(
        parsed.isOverBudget ||
          parsed.commands.some(
            (simple) =>
              programOf({ command: simple }).name === 'git' && simple.words.includes('-f'),
          ),
      ).toBe(true);
    },
  );

  test('the budget: too many commands or words, or a line nested past the depth limit, is flagged', () => {
    expect(parseShellChecked({ command: 'git status && ls' }).isOverBudget).toBe(false);
    expect(
      parseShellChecked({
        command: Array.from({ length: ShellBudget.MAX_COMMANDS + 1 }, () => 'ls').join('; '),
      }).isOverBudget,
    ).toBe(true);
    expect(
      parseShellChecked({ command: `echo ${'a '.repeat(ShellBudget.MAX_WORDS + 1)}` }).isOverBudget,
    ).toBe(true);

    // Substitutions and evals nest without quoting trouble; four levels are read, a fifth is flagged.
    const substitutions = (levels: number): string =>
      Array.from({ length: levels }).reduce<string>(
        (text) => `echo $(${text})`,
        'git push -f origin main',
      );
    const evals = (levels: number): string => `${'eval '.repeat(levels)}git push -f origin main`;

    // The limit is exact: four levels are read, the fifth is the first flagged.
    expect(parseShellChecked({ command: substitutions(3) }).isOverBudget).toBe(false);
    expect(parseShellChecked({ command: substitutions(4) }).isOverBudget).toBe(false);
    expect(parseShellChecked({ command: substitutions(5) }).isOverBudget).toBe(true);
    expect(parseShellChecked({ command: substitutions(8) }).isOverBudget).toBe(true);
    expect(parseShellChecked({ command: evals(3) }).isOverBudget).toBe(false);
    expect(parseShellChecked({ command: evals(4) }).isOverBudget).toBe(false);
    expect(parseShellChecked({ command: evals(5) }).isOverBudget).toBe(true);
    expect(parseShellChecked({ command: evals(8) }).isOverBudget).toBe(true);
    expect(parseShellChecked({ command: "bash -c 'git status'" }).isOverBudget).toBe(false);
  });

  test('a value that is not a command line is read as what it is, and nesting stops at the depth limit', () => {
    expect(
      programOf({ command: parseShell({ command: 'env -S "FOO=1 git status"' })[0]! })
        .splitCommands,
    ).toEqual([['env', 'FOO=1', 'git', 'status']]);

    const deep = Array.from({ length: 12 }).reduce<string>(
      (text) => `env -S "${text.replaceAll('"', '\\"')}"`,
      'git push -f origin main',
    );

    expect(() => parseShell({ command: deep })).not.toThrow();
  });

  test('a heredoc body is data, the commands around it are read', () => {
    expect(wordsOf('cat <<EOF\ngit push -f origin main\nEOF\nls')).toEqual([
      ['cat', 'EOF'],
      ['ls'],
    ]);
    expect(
      wordsOf(`git commit -m "$(cat <<'EOF'\nnever rm -rf\nEOF\n)"`).some((w) => w[0] === 'rm'),
    ).toBe(false);
  });

  test('shell keywords and braces open a command', () => {
    expect(programOf({ command: parseShell({ command: '{ git status; }' })[0]! }).name).toBe('git');
    expect(
      parseShell({ command: 'if true; then git status; fi' }).map(
        (c) => programOf({ command: c }).name,
      ),
    ).toContain('git');
  });

  test('an empty line and unbalanced quotes do not throw', () => {
    expect(parseShell({ command: '' })).toEqual([]);
    expect(() => parseShell({ command: `echo "unterminated` })).not.toThrow();
  });
});
