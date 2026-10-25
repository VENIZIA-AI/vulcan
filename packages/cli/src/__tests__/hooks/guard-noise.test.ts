import { describe, expect, test } from 'bun:test';
import {
  commandTextsOf,
  inspectCommand,
  inspectGit,
  inspectRemoteCommand,
  isDataOnly,
  parseShell,
  splitHeredocs,
} from '../../hooks/index.ts';
import { ASKS, QUIET } from './noise-corpus.ts';

const POLICY = { trusted: ['lab1'], readOnly: [] as string[] };

const asksOf = (command: string): string[] => [
  ...inspectCommand({ command, cwd: '/nowhere' }).map((hit) => `write ${hit.rule}: ${hit.message}`),
  ...inspectRemoteCommand({ command, policy: POLICY }).map((hit) => `remote: ${hit.message}`),
];

// BANA's scan: 142 asks in 13,000 Bash calls, most of them on data. These shapes stay quiet; the real ones ask.
describe('the write guard and the remote-host guard do not ask about data', () => {
  test.each(QUIET)('$id is quiet: $note', ({ command }) => {
    expect(asksOf(command)).toEqual([]);
  });

  test.each(ASKS)('$id still asks: $note', ({ command }) => {
    expect(asksOf(command).length).toBeGreaterThan(0);
  });
});

describe('a heredoc body', () => {
  test('is taken out of the text and carried by the command that reads it, the delimiter being no word', () => {
    const [cat] = parseShell({ command: "cat > f <<'EOF'\nkubectl apply -f x\nEOF" });

    expect(cat?.words).toEqual(['cat']);
    expect(cat?.redirects).toEqual(['f']);
    expect(cat?.heredoc).toBe('kubectl apply -f x');
  });

  test('that a shell reads stays in the text and is read as commands, for every guard', () => {
    const split = splitHeredocs({ command: 'bash <<EOF\ngit push -f origin main\nEOF' });

    expect(split.text).toContain('git push -f origin main');
    expect(split.heredocs).toEqual([{ body: 'git push -f origin main', isInline: true }]);
    expect(
      inspectGit({
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
      expect(splitHeredocs({ command }).text, command).toContain('kubectl apply');
      expect(asksOf(command).length, command).toBeGreaterThan(0);
    }
  });

  test('a here-string and a `<<` in quotes are not heredocs', () => {
    expect(parseShell({ command: 'cat <<< hello' })[0]?.heredoc).toBeUndefined();
    expect(splitHeredocs({ command: "echo '<<EOF'\nls" }).heredocs).toEqual([]);
  });

  test('an unterminated body is data up to the end of the command', () => {
    const [cat] = parseShell({ command: 'cat > f <<EOF\nkubectl apply -f x' });

    expect(cat?.heredoc).toBe('kubectl apply -f x');
    expect(asksOf('cat > f <<EOF\nkubectl apply -f x')).toEqual([]);
  });
});

describe('commandTextsOf and isDataOnly', () => {
  test('a search or a print is its bare name; a command that runs something keeps its words', () => {
    expect(commandTextsOf({ command: 'rg -n "kubectl apply" docs/', withMessages: true })).toEqual([
      'rg',
    ]);
    expect(commandTextsOf({ command: 'kubectl apply -f x', withMessages: true })).toEqual([
      'kubectl apply -f x',
    ]);
    expect(
      commandTextsOf({
        command: "find . -name '*.yaml' -exec kubectl delete -f {} +",
        withMessages: true,
      }),
    ).toEqual(['find . -name *.yaml -exec kubectl delete -f {} +']);
    expect(commandTextsOf({ command: 'find . -name "*.md"', withMessages: true })).toEqual([
      'find',
    ]);
  });

  test('git and gh are data to the write guard, and a host to the remote-host guard', () => {
    const [push] = parseShell({ command: 'git remote add x user@evil.example.com:repo' });

    expect(push !== undefined && isDataOnly({ command: push, withMessages: true })).toBe(true);
    expect(push !== undefined && isDataOnly({ command: push, withMessages: false })).toBe(false);
  });

  test('a read-only tool behind a wrapper is still data, and a wrapper of a real command is not', () => {
    const [xargsRg] = parseShell({ command: 'xargs rg "ssh|scp" docs' });
    const [xargsKubectl] = parseShell({ command: 'xargs kubectl delete -f' });

    expect(xargsRg !== undefined && isDataOnly({ command: xargsRg, withMessages: true })).toBe(
      true,
    );
    expect(
      xargsKubectl !== undefined && isDataOnly({ command: xargsKubectl, withMessages: true }),
    ).toBe(false);
  });

  test('a heredoc body is part of the command only where its reader runs it', () => {
    expect(
      commandTextsOf({ command: 'psql app <<EOF\ndelete from t;\nEOF', withMessages: true })[0],
    ).toContain('delete from t');
    expect(
      commandTextsOf({ command: 'cat > f <<EOF\ndelete from t;\nEOF', withMessages: true })[0],
    ).toBe('cat');
  });

  test('a pipe into a program that runs its input keeps the whole text, a pipe into xargs rg does not', () => {
    expect(commandTextsOf({ command: 'echo "kubectl apply" | sh', withMessages: true })).toEqual([
      'echo "kubectl apply" | sh',
    ]);
    expect(
      commandTextsOf({ command: 'find . | xargs rg "drizzle-kit push"', withMessages: true }),
    ).toEqual(['find', 'rg']);
  });
});
