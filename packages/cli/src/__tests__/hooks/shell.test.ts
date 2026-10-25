import { describe, expect, test } from 'bun:test';
import { parseShell, programOf } from '../../hooks/index.ts';

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

    expect(programOf({ command: command! })).toEqual({ name: 'git', index: 3, args: ['status'] });
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
