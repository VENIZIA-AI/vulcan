import { describe, expect, test } from 'bun:test';
import { CommandView, GitGuard, ShellParser, WriteGuard } from '../../hooks/index.ts';
import { ASKS, QUIET } from './noise-corpus.ts';

const asksOf = (command: string): string[] => [
  ...WriteGuard.inspectCommand({ command, cwd: '/nowhere' }).map(
    (hit) => `write ${hit.rule}: ${hit.message}`,
  ),
];

// A downstream project's scan: 142 asks in 13,000 Bash calls, most of them on data. These shapes stay quiet; the real ones ask.
describe('the write guard does not ask about data', () => {
  test.each(QUIET)('$id is quiet: $note', ({ command }) => {
    expect(asksOf(command)).toEqual([]);
  });

  test.each(ASKS)('$id still asks: $note', ({ command }) => {
    expect(asksOf(command).length).toBeGreaterThan(0);
  });
});

describe('a heredoc body', () => {
  test('is taken out of the text and carried by the command that reads it, the delimiter being no word', () => {
    const [cat] = ShellParser.parse({ command: "cat > f <<'EOF'\nkubectl apply -f x\nEOF" });

    expect(cat?.words).toEqual(['cat']);
    expect(cat?.redirects).toEqual(['f']);
    expect(cat?.heredoc).toBe('kubectl apply -f x');
  });

  test('that a shell reads stays in the text and is read as commands, for every guard', () => {
    const split = ShellParser.splitHeredocs({
      command: 'bash <<EOF\ngit push -f origin main\nEOF',
    });

    expect(split.text).toContain('git push -f origin main');
    expect(split.heredocs).toEqual([{ body: 'git push -f origin main', isInline: true }]);
    expect(
      GitGuard.inspect({
        command: 'bash <<EOF\ngit push -f origin main\nEOF',
        cwd: '/nowhere',
        run: () => undefined,
      }).map((hit) => hit.decision),
    ).toContain('deny');
  });

  test('behind a wrapper, a cd or a redirect, the program that reads it is still found', () => {
    for (const command of [
      'sudo bash <<EOF\nkubectl apply -f x\nEOF',
      'cd x && bash <<EOF\nkubectl apply -f x\nEOF',
      'FOO=1 bash <<EOF\nkubectl apply -f x\nEOF',
      'bash 2>/dev/null <<EOF\nkubectl apply -f x\nEOF',
    ]) {
      expect(ShellParser.splitHeredocs({ command }).text, command).toContain('kubectl apply');
      expect(asksOf(command).length, command).toBeGreaterThan(0);
    }
  });

  test('a here-string and a `<<` in quotes are not heredocs', () => {
    expect(ShellParser.parse({ command: 'cat <<< hello' })[0]?.heredoc).toBeUndefined();
    expect(ShellParser.splitHeredocs({ command: "echo '<<EOF'\nls" }).heredocs).toEqual([]);
  });

  test('an unterminated body is data up to the end of the command, and the guards ask', () => {
    const [cat] = ShellParser.parse({ command: 'cat > f <<EOF\nkubectl apply -f x' });

    expect(cat?.heredoc).toBe('kubectl apply -f x');
    expect(asksOf('cat > f <<EOF\nkubectl apply -f x')).not.toEqual([]);
  });
});

describe('CommandView.commandTextsOf and isDataOnly', () => {
  test('a search or a print is its bare name; a command that runs something keeps its words', () => {
    expect(
      CommandView.commandTextsOf({ command: 'rg -n "kubectl apply" docs/', withMessages: true }),
    ).toEqual(['rg']);
    expect(
      CommandView.commandTextsOf({ command: 'kubectl apply -f x', withMessages: true }),
    ).toEqual(['kubectl apply -f x']);
    expect(
      CommandView.commandTextsOf({
        command: "find . -name '*.yaml' -exec kubectl delete -f {} +",
        withMessages: true,
      }),
    ).toEqual(['find . -name *.yaml -exec kubectl delete -f {} +']);
    expect(
      CommandView.commandTextsOf({ command: 'find . -name "*.md"', withMessages: true }),
    ).toEqual(['find']);
  });

  test('git and gh are data to the write guard', () => {
    const [push] = ShellParser.parse({ command: 'git remote add x user@evil.example.com:repo' });

    expect(
      push !== undefined && CommandView.isDataOnly({ command: push, withMessages: true }),
    ).toBe(true);
    expect(
      push !== undefined && CommandView.isDataOnly({ command: push, withMessages: false }),
    ).toBe(false);
  });

  test('a read-only tool behind a wrapper is still data, and a wrapper of a real command is not', () => {
    const [xargsRg] = ShellParser.parse({ command: 'xargs rg "ssh|scp" docs' });
    const [xargsKubectl] = ShellParser.parse({ command: 'xargs kubectl delete -f' });

    expect(
      xargsRg !== undefined && CommandView.isDataOnly({ command: xargsRg, withMessages: true }),
    ).toBe(true);
    expect(
      xargsKubectl !== undefined &&
        CommandView.isDataOnly({ command: xargsKubectl, withMessages: true }),
    ).toBe(false);
  });

  test('a heredoc body is part of the command only where its reader runs it', () => {
    expect(
      CommandView.commandTextsOf({
        command: 'psql app <<EOF\ndelete from t;\nEOF',
        withMessages: true,
      })[0],
    ).toContain('delete from t');
    expect(
      CommandView.commandTextsOf({
        command: 'cat > f <<EOF\ndelete from t;\nEOF',
        withMessages: true,
      })[0],
    ).toBe('cat');
  });

  test('a pipe into a program that runs its input keeps the whole text, a pipe into xargs rg does not', () => {
    expect(
      CommandView.commandTextsOf({ command: 'echo "kubectl apply" | sh', withMessages: true }),
    ).toEqual(['echo "kubectl apply" | sh']);
    expect(
      CommandView.commandTextsOf({
        command: 'find . | xargs rg "drizzle-kit push"',
        withMessages: true,
      }),
    ).toEqual(['find', 'rg']);
  });
});

/** Lines whose next line is a command bash runs: a comment, arithmetic or a quote that spans lines comes first. */
const BEFORE_A_COMMAND: { note: string; lead: string }[] = [
  { note: 'a comment that holds <<', lead: '# feed <<STOP to the reader' },
  { note: 'a comment with an apostrophe', lead: "# don't stop here" },
  { note: 'a shift in $(( ))', lead: 'echo $(( 2 << n ))' },
  { note: 'a shift in (( ))', lead: '(( mask << bits ))' },
  { note: 'a double-quoted string over two lines', lead: 'printf "%s" "first\n<<STOP"' },
  { note: 'a single-quoted string over two lines', lead: "printf 'one\n<<STOP'" },
];

const gitDecisions = (command: string): string[] =>
  GitGuard.inspect({ command, cwd: '/nowhere', run: () => 'topic' }).map((hit) => hit.decision);

describe('every guard reads the command after a line that only looks like a heredoc start', () => {
  test.each(BEFORE_A_COMMAND)('after $note, a force push is denied', ({ lead }) => {
    expect(gitDecisions(`${lead}\ngit push --force origin main`)).toContain('deny');
  });

  test.each(BEFORE_A_COMMAND)(
    'after $note, a deploy write and a database write ask',
    ({ lead }) => {
      const write = WriteGuard.inspectCommand({
        command: `${lead}\nkubectl apply -f deploy.yaml`,
        cwd: '/nowhere',
      });
      const database = WriteGuard.inspectCommand({
        command: `${lead}\npsql app -c "delete from users"`,
        cwd: '/nowhere',
      });

      expect(write.length).toBeGreaterThan(0);
      expect(database.length).toBeGreaterThan(0);
    },
  );

  test('a real heredoc with the same words in its body is still data to every guard', () => {
    const body = `${BEFORE_A_COMMAND.map((row) => row.lead).join('\n')}\ngit push --force origin main\nkubectl apply -f deploy.yaml\npsql app -c "delete from users"`;

    for (const command of [
      `cat > notes.md <<'STOP'\n${body}\nSTOP`,
      `body=$(cat <<'STOP'\n${body}\nSTOP\n)\ngh issue create --body "$body"`,
    ]) {
      expect(gitDecisions(command), command).toEqual([]);
      expect(asksOf(command), command).toEqual([]);
    }
  });

  test('a line the parser cannot follow to its end asks in every guard', () => {
    const command = 'echo "never closed\ngit status';

    expect(gitDecisions(command)).toContain('ask');
    expect(asksOf(command).some((ask) => ask.startsWith('write'))).toBe(true);
    expect(gitDecisions('echo "closed\nhere"')).toEqual([]);
    expect(asksOf('echo "closed\nhere"')).toEqual([]);
  });

  test('a body whose delimiter never comes is data, and the git guard still asks about a push in it', () => {
    expect(gitDecisions('cat > notes.md <<STOP\ngit push --force origin main')).toContain('ask');
    // The guard asks about any body whose delimiter never comes, even one that holds nothing risky.
    expect(gitDecisions('cat > notes.md <<STOP\ngit status')).toEqual(['ask']);
  });
});

describe('a program the line does not name', () => {
  test('a variable or a substitution as the program asks in the git and write guards', () => {
    expect(gitDecisions('tool=git; $tool push --force origin main')).toContain('ask');
    expect(
      asksOf('tool=kubectl; "$tool" apply -f deploy.yaml').some((ask) => ask.startsWith('write')),
    ).toBe(true);
  });

  test('a variable or a substitution as an argument stays quiet', () => {
    expect(gitDecisions('git log "$HOME" $(date +%s)')).toEqual([]);
    expect(asksOf('echo "$HOME" $(date +%s) "$@"')).toEqual([]);
  });
});

describe('a command inside a process substitution or run through a variable is read by every guard', () => {
  test.each([
    'cat >(kubectl apply -f -) < manifest.yaml',
    'echo >(bash deploy.sh)',
    'k=kubectl; $k apply -f manifest.yaml',
    '$(echo kubectl) apply -f manifest.yaml',
    'tee >(psql -c "delete from t") < rows.txt',
  ])('%s asks in the write guard', (command) => {
    expect(WriteGuard.inspectCommand({ command, cwd: '/nowhere' }).length).toBeGreaterThan(0);
  });

  test.each(['k=git; $k push --force origin main', 'echo >(git push --force origin main)'])(
    '%s is not allowed by the git guard',
    (command) => {
      expect(gitDecisions(command).length).toBeGreaterThan(0);
    },
  );

  test('a variable as an argument stays quiet, a program under a variable folder asks', () => {
    expect(WriteGuard.inspectCommand({ command: 'ls $HOME/projects', cwd: '/nowhere' })).toEqual(
      [],
    );
    expect(
      WriteGuard.inspectCommand({ command: '$HOME/.bun/bin/bun install', cwd: '/nowhere' }).length,
    ).toBeGreaterThan(0);
  });
});
