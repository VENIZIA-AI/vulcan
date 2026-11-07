import { describe, expect, test } from 'bun:test';
import { ShellBudget, ShellParser } from '../../hooks/index.ts';

const wordsOf = (command: string): string[][] =>
  ShellParser.parse({ command }).map((simple) => simple.words);

describe('ShellParser.parse', () => {
  test('splits on ;, &&, ||, | and newlines', () => {
    expect(wordsOf('a 1 && b 2; c | d\ne')).toEqual([['a', '1'], ['b', '2'], ['c'], ['d'], ['e']]);
  });

  test('quotes keep a word whole and an operator inside quotes splits nothing', () => {
    expect(wordsOf(`git commit -m "fix: a; b && c" 'x y'`)).toEqual([
      ['git', 'commit', '-m', 'fix: a; b && c', 'x y'],
    ]);
  });

  test('redirects are collected, descriptor duplicates are not', () => {
    const [command] = ShellParser.parse({ command: 'echo hi > out.txt 2>&1 >> log.txt' });

    expect(command?.words).toEqual(['echo', 'hi']);
    expect(command?.redirects).toEqual(['out.txt', 'log.txt']);
  });

  test('&> and 2> name files too', () => {
    const [command] = ShellParser.parse({ command: 'run &> all.log 2>err.log' });

    expect(command?.redirects).toEqual(['all.log', 'err.log']);
  });

  test('leading NAME=value words are assignments, not the program', () => {
    const [command] = ShellParser.parse({ command: 'TMPDIR=/tmp FOO=1 mktemp' });

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
    const [simple] = ShellParser.parse({ command });

    expect(ShellParser.programOf({ command: simple! }).name).toBe('git');
    expect(ShellParser.programOf({ command: simple! }).args).toEqual(['status']);
  });

  test('an option whose value is the next word: the value is not taken for the program', () => {
    const [simple] = ShellParser.parse({ command: 'xargs -n 1 -I {} sudo -u root git log' });

    expect(ShellParser.programOf({ command: simple! }).name).toBe('git');
  });

  test('ShellParser.programOf skips wrappers and flags before the program', () => {
    const [command] = ShellParser.parse({ command: 'sudo -n env git status' });

    expect(ShellParser.programOf({ command: command! })).toEqual({
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
      ShellParser.parse({ command }).some(
        (simple) =>
          ShellParser.programOf({ command: simple }).name === 'git' && simple.words.includes('-f'),
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
      ShellParser.parse({ command }).some(
        (simple) =>
          ShellParser.programOf({ command: simple }).name === 'git' && simple.words.includes('-f'),
      ),
    ).toBe(false);
  });

  const isForcePush = (command: string): boolean =>
    ShellParser.parse({ command }).some(
      (simple) =>
        ShellParser.programOf({ command: simple }).name === 'git' && simple.words.includes('-f'),
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
    const [simple] = ShellParser.parse({ command: 'nice --adj 5 git status' });

    expect(ShellParser.programOf({ command: simple! }).name).toBe('git');
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
    const firstWords = (command: string): string[] =>
      ShellParser.parse({ command })[0]?.words ?? [];

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

  test('ShellParser.splitEnvString splits by env rules', () => {
    expect(ShellParser.splitEnvString({ value: 'a b  c' })).toEqual(['a', 'b', 'c']);
    expect(ShellParser.splitEnvString({ value: 'a \'b c\' "d e"' })).toEqual(['a', 'b c', 'd e']);
    expect(ShellParser.splitEnvString({ value: 'a\\_b' })).toEqual(['a', 'b']);
    expect(ShellParser.splitEnvString({ value: '"a\\_b"' })).toEqual(['a b']);
    expect(ShellParser.splitEnvString({ value: 'a\\cb c' })).toEqual(['a']);
    expect(ShellParser.splitEnvString({ value: 'a # comment' })).toEqual(['a']);
    expect(ShellParser.splitEnvString({ value: 'a#b' })).toEqual(['a#b']);
    expect(ShellParser.splitEnvString({ value: "'a\\'b' c" })).toEqual(["a'b", 'c']);
    expect(ShellParser.splitEnvString({ value: "'a\\nb'" })).toEqual(['a\\nb']);
    expect(ShellParser.splitEnvString({ value: 'a\\nb' })).toEqual(['a\nb']);
    expect(ShellParser.splitEnvString({ value: '' })).toEqual([]);
    expect(ShellParser.splitEnvString({ value: '""' })).toEqual(['']);
    expect(ShellParser.splitEnvString({ value: 'a;b|c $(d)' })).toEqual(['a;b|c', '$(d)']);
  });

  // The cost of a line is linear in its length, whatever it repeats; what is not read is said.
  test.each([20, 80, 110, 400])(
    'env then -S env x%i then a push is parsed fast, and is read or flagged',
    (count) => {
      const command = `env${' -S env'.repeat(count)} git push -f origin main`;
      const started = performance.now();
      const parsed = ShellParser.parseChecked({ command });

      expect(performance.now() - started).toBeLessThan(1000);
      expect(
        parsed.isOverBudget ||
          parsed.commands.some(
            (simple) =>
              ShellParser.programOf({ command: simple }).name === 'git' &&
              simple.words.includes('-f'),
          ),
      ).toBe(true);
    },
  );

  test('the budget: too many commands or words, or a line nested past the depth limit, is flagged', () => {
    expect(ShellParser.parseChecked({ command: 'git status && ls' }).isOverBudget).toBe(false);
    expect(
      ShellParser.parseChecked({
        command: Array.from({ length: ShellBudget.MAX_COMMANDS + 1 }, () => 'ls').join('; '),
      }).isOverBudget,
    ).toBe(true);
    expect(
      ShellParser.parseChecked({ command: `echo ${'a '.repeat(ShellBudget.MAX_WORDS + 1)}` })
        .isOverBudget,
    ).toBe(true);

    // Substitutions and evals nest without quoting trouble; four levels are read, a fifth is flagged.
    const substitutions = (levels: number): string =>
      Array.from({ length: levels }).reduce<string>(
        (text) => `echo $(${text})`,
        'git push -f origin main',
      );
    const evals = (levels: number): string => `${'eval '.repeat(levels)}git push -f origin main`;

    // The limit is exact: four levels are read, the fifth is the first flagged.
    expect(ShellParser.parseChecked({ command: substitutions(3) }).isOverBudget).toBe(false);
    expect(ShellParser.parseChecked({ command: substitutions(4) }).isOverBudget).toBe(false);
    expect(ShellParser.parseChecked({ command: substitutions(5) }).isOverBudget).toBe(true);
    expect(ShellParser.parseChecked({ command: substitutions(8) }).isOverBudget).toBe(true);
    expect(ShellParser.parseChecked({ command: evals(3) }).isOverBudget).toBe(false);
    expect(ShellParser.parseChecked({ command: evals(4) }).isOverBudget).toBe(false);
    expect(ShellParser.parseChecked({ command: evals(5) }).isOverBudget).toBe(true);
    expect(ShellParser.parseChecked({ command: evals(8) }).isOverBudget).toBe(true);
    expect(ShellParser.parseChecked({ command: "bash -c 'git status'" }).isOverBudget).toBe(false);
  });

  test('a value that is not a command line is read as what it is, and nesting stops at the depth limit', () => {
    expect(
      ShellParser.programOf({
        command: ShellParser.parse({ command: 'env -S "FOO=1 git status"' })[0]!,
      }).splitCommands,
    ).toEqual([['env', 'FOO=1', 'git', 'status']]);

    const deep = Array.from({ length: 12 }).reduce<string>(
      (text) => `env -S "${text.replaceAll('"', '\\"')}"`,
      'git push -f origin main',
    );

    expect(() => ShellParser.parse({ command: deep })).not.toThrow();
  });

  test('a heredoc body is data, the commands around it are read', () => {
    expect(wordsOf('cat <<EOF\ngit push -f origin main\nEOF\nls')).toEqual([['cat'], ['ls']]);
    expect(
      wordsOf(`git commit -m "$(cat <<'EOF'\nnever rm -rf\nEOF\n)"`).some((w) => w[0] === 'rm'),
    ).toBe(false);
  });

  test('shell keywords and braces open a command', () => {
    expect(
      ShellParser.programOf({ command: ShellParser.parse({ command: '{ git status; }' })[0]! })
        .name,
    ).toBe('git');
    expect(
      ShellParser.parse({ command: 'if true; then git status; fi' }).map(
        (c) => ShellParser.programOf({ command: c }).name,
      ),
    ).toContain('git');
  });

  test('an empty line and unbalanced quotes do not throw', () => {
    expect(ShellParser.parse({ command: '' })).toEqual([]);
    expect(() => ShellParser.parse({ command: `echo "unterminated` })).not.toThrow();
  });
});

const programsOf = (command: string): string[] =>
  ShellParser.parse({ command }).map((simple) => ShellParser.programOf({ command: simple }).name);

const pushOf = (command: string): boolean =>
  ShellParser.parse({ command }).some(
    (simple) =>
      ShellParser.programOf({ command: simple }).name === 'git' && simple.words.includes('-f'),
  );

/** Ordinary lines and the commands they are read as: the same before and after the scanner learnt comments and quotes. */
const ORDINARY: { command: string; words: string[][] }[] = [
  { command: 'cat <<EOF\nhello $USER\nEOF', words: [['cat']] },
  { command: "cat <<'EOF'\nhello $USER\nEOF\nls", words: [['cat'], ['ls']] },
  { command: 'cat <<EOF > f\nbody\nEOF', words: [['cat']] },
  { command: "cat <<-'EOF'\n\tbody\n\tEOF\nls", words: [['cat'], ['ls']] },
  { command: 'cat <<< "word"\nls', words: [['cat'], ['ls']] },
  {
    command: `git commit -m "$(cat <<'EOF'\nfix: a thing\n\nmore\nEOF\n)"`,
    words: [['git', 'commit', '-m', `$(cat <<'EOF'\nfix: a thing\n\nmore\nEOF\n)`], ['cat']],
  },
  { command: 'echo $#', words: [['echo', '$#']] },
  { command: 'echo ${#var}', words: [['echo', '${#var}']] },
  { command: 'bash <<EOF\ngit status\nEOF', words: [['bash'], ['git', 'status']] },
  {
    command: 'git status && git diff | head -5',
    words: [
      ['git', 'status'],
      ['git', 'diff'],
      ['head', '-5'],
    ],
  },
  {
    command: 'x=$(git rev-parse HEAD) && echo $x',
    words: [[], ['echo', '$x'], ['git', 'rev-parse', 'HEAD']],
  },
  {
    command: 'diff <(sort a) <(sort b)',
    words: [
      ['diff', '<(sort a)', '<(sort b)'],
      ['sort', 'a'],
      ['sort', 'b'],
    ],
  },
  { command: 'echo "multi\nline" && ls', words: [['echo', 'multi\nline'], ['ls']] },
];

describe('ShellParser reads a line the way bash does', () => {
  test.each(ORDINARY)('an ordinary line is read as before: $command', ({ command, words }) => {
    const parsed = ShellParser.parseChecked({ command });

    expect(parsed.commands.map((simple) => simple.words)).toEqual(words);
    expect(parsed.isUncertain).toBe(false);
  });

  test('a comment ends at the newline, and nothing in it starts a heredoc', () => {
    expect(wordsOf('# a note\nls -la')).toEqual([['ls', '-la']]);
    expect(wordsOf('ls # trailing words')).toEqual([['ls']]);
    expect(programsOf('# read <<END later\ngit push -f origin main')).toEqual(['git']);
    expect(programsOf("# it's a note\ngit push -f origin main")).toEqual(['git']);
    expect(ShellParser.parseChecked({ command: '# x <<END\nls' }).isUncertain).toBe(false);
  });

  test('a # inside a word, a parameter or quotes is not a comment', () => {
    expect(wordsOf('echo $# ${#x} a#b "#c" \'#d\'')).toEqual([
      ['echo', '$#', '${#x}', 'a#b', '#c', '#d'],
    ]);
    expect(wordsOf('echo ${x#y} && ls')).toEqual([['echo', '${x#y}'], ['ls']]);
  });

  test('a << in arithmetic is a shift, not a heredoc', () => {
    expect(wordsOf('echo $((1<<2))')).toEqual([['echo', '$((1<<2))']]);
    expect(pushOf('echo $((1<<n))\ngit push -f origin main')).toBe(true);
    expect(pushOf('(( x << 2 ))\ngit push -f origin main')).toBe(true);
    expect(pushOf('echo $[1<<2]\ngit push -f origin main')).toBe(true);
    expect(pushOf('echo $((\n1 << 2\n))\ngit push -f origin main')).toBe(true);
    expect(ShellParser.parseChecked({ command: 'echo $((1<<n))\nls' }).isUncertain).toBe(false);
  });

  test('a substitution inside arithmetic is still read as commands', () => {
    expect(pushOf('echo $(( $(git push -f origin main) + 1 ))')).toBe(true);
    expect(pushOf('(( $(git push -f origin main) ))')).toBe(true);
  });

  test('a quote that spans lines keeps the lines inside it, and a << inside it is text', () => {
    expect(pushOf('echo "a\n<<EOF"\ngit push -f origin main')).toBe(true);
    expect(pushOf("echo 'a\n<<EOF'\ngit push -f origin main")).toBe(true);
    expect(pushOf("echo $'a\n<<EOF'\ngit push -f origin main")).toBe(true);
    expect(pushOf('echo "a\n<<EOF" && git push -f origin main')).toBe(true);
    expect(ShellParser.splitHeredocs({ command: 'echo "a\n<<EOF"\nls' }).heredocs).toEqual([]);
  });

  test('a heredoc body is data, whatever quotes or words it holds', () => {
    expect(wordsOf("cat > f <<'EOF'\nit's here\ngit push -f origin main\nEOF\nls")).toEqual([
      ['cat'],
      ['ls'],
    ]);
    expect(
      pushOf(`git commit -m "$(cat <<'EOF'\nit's done; git push -f origin main\nEOF\n)"`),
    ).toBe(false);
    expect(
      ShellParser.parseChecked({ command: `git commit -m "$(cat <<'EOF'\nit's done\nEOF\n)"` })
        .isUncertain,
    ).toBe(false);
  });

  test('the delimiter may be quoted or escaped, and <<- strips leading tabs', () => {
    for (const command of [
      'cat <<\\EOF\ngit push -f origin main\nEOF\nls',
      'cat <<"A B"\ngit push -f origin main\nA B\nls',
      "cat << 'E'OF\ngit push -f origin main\nEOF\nls",
      'cat <<-EOF\n\tgit push -f origin main\n\tEOF\nls',
      'cat <<END-OF\ngit push -f origin main\nEND-OF\nls',
    ]) {
      expect(programsOf(command), command).toEqual(['cat', 'ls']);
    }
  });

  test('several heredocs read their bodies in order, each paired with its own command', () => {
    // Two on one command: both bodies are data, and the last one is what the command reads.
    expect(ShellParser.parse({ command: 'cat <<A <<B\na\nA\nb\nB\nls' })).toEqual([
      {
        words: ['cat'],
        redirects: [],
        assignments: [],
        input: { files: [], texts: [], hasHeredoc: true },
        heredoc: 'b',
        expandedBodies: ['a', 'b'],
      },
      { words: ['ls'], redirects: [], assignments: [] },
    ]);

    const [first, second] = ShellParser.parse({
      command: 'cat <<A > a; (( n << 1 )); tee b <<B\nfirst\nA\nsecond\nB',
    });

    expect(first?.heredoc).toBe('first');
    expect(second?.heredoc).toBe('second');
  });

  test('a heredoc inside a substitution stays with the command that reads it', () => {
    const psql = ShellParser.parse({ command: 'x=$(psql <<SQL\nselect 1;\nSQL\n)\nls' }).find(
      (simple) => simple.words[0] === 'psql',
    );

    expect(psql?.heredoc).toBe('select 1;');
  });

  test('the text of a line drops every data body, inside a substitution too, and keeps a body a shell reads', () => {
    expect(
      ShellParser.splitHeredocs({ command: "body=$(cat <<'EOF'\nssh host uptime\nEOF\n)\nls" })
        .text,
    ).toBe("body=$(cat <<'EOF'\n)\nls");
    expect(
      ShellParser.splitHeredocs({ command: 'x=$(bash <<EOF\ngit status\nEOF\n)' }).text,
    ).toContain('git status');
  });

  test('an unquoted delimiter expands substitutions in the body; a quoted one does not', () => {
    expect(pushOf('cat > f <<EOF\n$(git push -f origin main)\nEOF')).toBe(true);
    expect(pushOf('cat > f <<EOF\n`git push -f origin main`\nEOF')).toBe(true);
    expect(pushOf("cat > f <<'EOF'\n$(git push -f origin main)\nEOF")).toBe(false);
  });

  test('a body that does not end is data, and is also read as commands on the side', () => {
    const parsed = ShellParser.parseChecked({ command: 'cat > f <<EOF\ngit push -f origin main' });

    expect(parsed.commands.map((simple) => simple.words)).toEqual([['cat']]);
    expect(parsed.isUncertain).toBe(true);
    expect(parsed.unterminatedHeredocCommands.map((simple) => simple.words)).toEqual([
      ['git', 'push', '-f', 'origin', 'main'],
    ]);
    expect(ShellParser.parseChecked({ command: 'cat <<EOF' }).unterminatedHeredocCommands).toEqual(
      [],
    );
  });

  test('a line it cannot follow to the end is flagged uncertain', () => {
    for (const command of [
      'echo "open\ngit push -f origin main',
      "echo 'open\ngit push -f origin main",
      'echo $(git status',
      'echo ${x',
      'echo $((1 + 2',
      'cat <<',
      '((git status); ls)',
      `${'$('.repeat(200)}`,
    ]) {
      expect(ShellParser.parseChecked({ command }).isUncertain, command).toBe(true);
    }

    for (const command of ['ls', 'echo "a\nb"', 'cat <<EOF', 'case x in a) ls;; esac']) {
      expect(ShellParser.parseChecked({ command }).isUncertain, command).toBe(false);
    }
  });

  test('the scanner is linear: long runs of what it tracks are read fast', () => {
    for (const command of [
      '<'.repeat(90_000),
      '<<'.repeat(40_000),
      '$('.repeat(40_000),
      '"$('.repeat(30_000),
      '#\n'.repeat(45_000),
      'a\n'.repeat(45_000),
      `cat <<EOF\n${'x\n'.repeat(45_000)}EOF`,
      `${'cat <<A '.repeat(9_000)}\n`,
    ]) {
      const started = performance.now();

      ShellParser.parseChecked({ command });
      expect(performance.now() - started, command.slice(0, 20)).toBeLessThan(1000);
    }
  });
});

describe('ShellParser reads more of what bash reads', () => {
  test('a # right after an expansion or an escaped blank is part of the word, not a comment', () => {
    for (const command of [
      'echo $((1))#x; ls',
      'echo $(date)#y; ls',
      'echo ${x}#y; ls',
      'echo a\\ #b; ls',
      'x=$((1))#; ls',
      'echo $(( $(date) ))#x; ls',
    ]) {
      expect(programsOf(command), command).toContain('ls');
    }

    expect(wordsOf('echo a #b; ls')).toEqual([['echo', 'a']]);
  });

  test('the ) of a case pattern does not close the substitution around it', () => {
    for (const command of [
      'echo $(case x in x) ls;; esac)',
      'echo "$(case x in x|y) ls;; esac)"',
      'echo $(case x in (x) ls;; esac)',
      'cat <(case x in x) ls;; esac)',
      'x=$(case x in\nx)\nls\n;;\nesac\n)',
    ]) {
      expect(programsOf(command), command).toContain('ls');
      expect(ShellParser.parseChecked({ command }).isUncertain, command).toBe(false);
    }
  });

  test('an escaped backtick inside backticks is a substitution of its own', () => {
    expect(programsOf('echo `echo \\`ls\\``')).toContain('ls');
    expect(programsOf('echo "`echo \\`ls\\``"')).toContain('ls');
    expect(programsOf('x=`echo \\`pwd \\\\\\`ls\\\\\\`\\``')).toEqual(
      expect.arrayContaining(['pwd', 'ls']),
    );
  });

  test('>(...) is a process substitution like <(...), its text read as commands', () => {
    const [first] = ShellParser.parse({ command: 'tee >(wc -l) <(sort a)' });

    expect(first?.words).toEqual(['tee', '>(wc -l)', '<(sort a)']);
    expect(programsOf('tee >(wc -l) <(sort a)')).toEqual(['tee', 'wc', 'sort']);
    expect(programsOf('echo a>(wc)')).toContain('wc');
    expect(programsOf('cat < >(wc)')).toContain('wc');
    expect(programsOf('tee >(tee >(wc))')).toEqual(['tee', 'tee', 'wc']);
  });

  test('coproc, function, builtin and trap name the command they run', () => {
    expect(programsOf('coproc ls')).toEqual(['ls']);
    expect(programsOf('coproc NAME { ls; }')).toEqual(['ls', '']);
    expect(programsOf('coproc { ls; }')).toEqual(['ls', '']);
    expect(programsOf('function g { ls; }; g')).toEqual(['ls', '', 'g']);
    expect(programsOf('builtin eval ls')).toEqual(['eval', 'ls']);
    expect(programsOf('builtin command ls')).toEqual(['ls']);
    expect(programsOf("trap 'ls; pwd' EXIT")).toEqual(['trap', 'ls', 'pwd']);
    expect(programsOf('trap -- "ls" INT ERR')).toEqual(['trap', 'ls']);

    for (const command of ['trap -p', 'trap -p INT', 'trap - INT', 'trap INT', 'trap -l']) {
      expect(programsOf(command), command).toEqual(['trap']);
    }
  });

  test('a program named by a variable or a substitution is flagged; one in an argument is not', () => {
    for (const command of [
      '$cmd',
      '"$x" a',
      '"$@"',
      '${x} a',
      '$(echo git) push',
      'eval "$(tool env)"',
      // An unquoted expansion is split at its blanks, so a variable in the folder part names the program too.
      '$k/deploy.yaml',
      '$g/home/x/repo push -f origin main',
      '/usr/bin/$tool x',
      '$HOME/$x/bin/tool',
      '${HOME}x/$k',
      '$HOME/.bun/bin/bun install',
      '"${BUN_INSTALL}/bin/bun" install',
    ]) {
      expect(ShellParser.parseChecked({ command }).hasUnknownProgram, command).toBe(true);
    }

    for (const command of ['echo $x "$@" ${y}', 'ls $(pwd)', 'x=$(date)', 'cat "$HOME/f"']) {
      expect(ShellParser.parseChecked({ command }).hasUnknownProgram, command).toBe(false);
    }
  });

  test('a descriptor number before a heredoc is not a word, and << may be split by a backslash-newline', () => {
    expect(wordsOf('cat 0<<EOF\nls\nEOF')).toEqual([['cat']]);
    expect(wordsOf('cat 3<<EOF\nls\nEOF')).toEqual([['cat']]);
    expect(wordsOf('cat <\\\n<EOF\nls\nEOF\npwd')).toEqual([['cat'], ['pwd']]);
  });

  test('the body ends only at the exact delimiter line, and a backslash-newline joins body lines', () => {
    const [cat, after] = ShellParser.parse({ command: 'cat <<EOF\nx\n EOF\nEOF \nEOF\nls' });

    expect(cat?.heredoc).toBe('x\n EOF\nEOF ');
    expect(after?.words).toEqual(['ls']);
    expect(ShellParser.parse({ command: 'cat <<EOF\nx\\\nEOF\ny\nEOF\nls' })[0]?.heredoc).toBe(
      'x\\\nEOF\ny',
    );
    expect(ShellParser.parse({ command: "cat <<'EOF'\nx\\\nEOF\nls" })[0]?.heredoc).toBe('x\\');
    expect(ShellParser.parse({ command: 'cat <<-EOF\n\tx\n\t\tEOF\nls' })[0]?.heredoc).toBe('\tx');
  });
});

describe('ShellParser.parse, on comments and scopes', () => {
  test('a comment runs to the end of its line; a # inside a word or quotes is text', () => {
    expect(wordsOf('#!/bin/bash\n# kubectl apply -f x | sh\necho hi # bye\nls')).toEqual([
      ['echo', 'hi'],
      ['ls'],
    ]);
    expect(wordsOf(`echo a#b '#c' "#d" $# \${#x}`)).toEqual([
      ['echo', 'a#b', '#c', '#d', '$#', '${#x}'],
    ]);
  });

  test('a << in a comment starts no heredoc', () => {
    expect(wordsOf('# usage <<EOF\nkubectl apply -f x\nEOF')).toEqual([
      ['kubectl', 'apply', '-f', 'x'],
      ['EOF'],
    ]);
  });

  test('a subshell, and a command line a word carries, each get their own scope', () => {
    const scopes = ShellParser.parse({ command: "(cd a; x); y; bash -c 'z'" }).map((command) => [
      command.words[0],
      command.scope ?? '',
    ]);

    expect(scopes).toEqual([
      ['cd', '/1'],
      ['x', '/1'],
      ['y', ''],
      ['bash', ''],
      ['z', '>2'],
    ]);
  });

  test('the ) of a case pattern closes no subshell', () => {
    const last = ShellParser.parse({ command: '(case x in a) true;; esac; y)' }).at(-1);

    expect(last?.words).toEqual(['y']);
    expect(last?.scope).toBe('/1');
  });
});

describe('the >&word redirect', () => {
  test('a word with an expansion is listed as a copy that may name a file; a descriptor is not', () => {
    const [command] = ShellParser.parse({ command: 'echo x >&$fd' });
    const [plain] = ShellParser.parse({ command: 'echo x >&2 2>&1 >&-' });

    expect(command?.redirects).toEqual(['$fd']);
    expect(command?.copies).toEqual(['$fd']);
    expect(plain?.redirects).toEqual([]);
    expect(plain?.copies).toBeUndefined();
  });

  test('a heredoc body whose delimiter is not quoted is listed as expanded; a quoted one is data', () => {
    const [open] = ShellParser.parse({ command: 'cat <<EOF\n${x@P}\nEOF' });
    const [shut] = ShellParser.parse({ command: "cat <<'EOF'\n${x@P}\nEOF" });

    expect(open?.expandedBodies).toEqual(['${x@P}']);
    expect(shut?.expandedBodies).toBeUndefined();
    expect(
      ShellParser.hasPromptExpansion({
        command: open ?? { words: [], redirects: [], assignments: [] },
      }),
    ).toBe(true);
  });

  test('>&file is a file redirect, and <> is a write target too', () => {
    expect(ShellParser.parse({ command: 'echo x >&out.txt' })[0]?.redirects).toEqual(['out.txt']);
    expect(ShellParser.parse({ command: 'cat 1<> f' })[0]?.redirects).toEqual(['f']);
  });
});
