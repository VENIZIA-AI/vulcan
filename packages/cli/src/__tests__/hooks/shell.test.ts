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
