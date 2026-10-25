import { describe, expect, test } from 'bun:test';
import { HookConstants, inspectGit, parseShellChecked, ShellBudget } from '../../hooks/index.ts';
import type { IGitRunner } from '../../hooks/index.ts';

/**
 * Every bypass the reviews of the guard parser found, each a way to hide `git push -f origin main`. A row here
 * stays fixed; the same table is on the hooks page. The guards stop accidents and drift, they are not a
 * sandbox, so a new row is a new find, not a promise that none is left.
 */
const BYPASSES: { id: string; found: string; command: string }[] = [
  { id: 'E-1', found: '#409', command: 'env --split "git push -f origin main"' },
  { id: 'E-2', found: '#409', command: 'env -S "-u X git push -f origin main"' },
  { id: 'E-3', found: '#409', command: `env -S "-S 'git push -f origin main'"` },
  { id: 'E-4', found: '#409', command: String.raw`env -S 'git\_push\_-f\_origin\_main'` },
  { id: 'E-5', found: '#409', command: String.raw`env -S "git push -f origin main\c trailing"` },
  {
    id: 'E-6',
    found: '#409',
    command: `env${' -S env'.repeat(110)} git push -f origin main`,
  },
  { id: 'Q-1', found: '#412', command: "$'git' push -f origin main" },
  { id: 'Q-2', found: '#412', command: "env -S $'git push -f origin main'" },
  { id: 'Q-3', found: '#412', command: "sh -c $'git push -f origin main'" },
  { id: 'B-1', found: '#414', command: String.raw`env -S "-u '\c' git push -f origin main"` },
  { id: 'B-2', found: '#414', command: String.raw`env -S "-u 'x\_y'z git push -f origin main"` },
  { id: 'B-3', found: '#414', command: String.raw`echo $'\c'; git push -f origin main` },
  { id: 'B-4', found: '#414', command: String.raw`echo $'\c\\'; git push -f origin main` },
  { id: 'B-5', found: '#414', command: 'xargs --eof git push -f origin main' },
  { id: 'B-6', found: '#414', command: 'xargs --max-lines git push -f origin main' },
  { id: 'B-7', found: '#414', command: '"gi\\\nt" push -f origin main' },
  { id: 'B-8', found: '#414', command: 'gi\\\nt push -f origin main' },
  { id: 'B-9', found: '#414', command: 'git \\\n push -f origin main' },
  { id: 'B-10', found: '#414', command: "echo '<<EOF'\ngit push -f origin main" },
  { id: 'B-11', found: '#414', command: 'cat <<< word\ngit push -f origin main' },
  { id: 'B-12', found: '#414', command: `echo "$(echo ')'; git push -f origin main)"` },
  { id: 'B-13', found: '#414', command: "watch -n 1 'git push -f origin main'" },
];

/** A fake `git`/`gh` that answers every query with a branch and counts the calls. */
const counting = (): { run: IGitRunner; calls: () => number } => {
  let calls = 0;

  return {
    run: () => {
      calls += 1;

      return 'topic';
    },
    calls: () => calls,
  };
};

const decisions = (opts: { command: string; run?: IGitRunner }): string[] =>
  inspectGit({ command: opts.command, cwd: '/p', run: opts.run ?? counting().run }).map(
    (hit) => hit.decision,
  );

describe('the bypasses the reviews found stay fixed', () => {
  test.each(BYPASSES)('$id ($found) is denied: $command', ({ command }) => {
    const started = performance.now();

    expect(decisions({ command })).toContain('deny');
    expect(performance.now() - started).toBeLessThan(1000);
  });

  test('a real heredoc and a quoted mention are still data, not commands', () => {
    expect(decisions({ command: 'cat <<EOF\ngit push -f origin main\nEOF' })).toEqual([]);
    expect(decisions({ command: "echo '<<EOF' && echo done" })).toEqual([]);
    expect(decisions({ command: 'echo "git push -f origin main"' })).toEqual([]);
  });
});

describe('a line the guard cannot read in full asks, and the guard does not crash or stall', () => {
  test('700,000 substitutions in one word (a stack overflow before) ask', () => {
    const command = `git push -f origin main; echo ${'``'.repeat(700_000)}`;
    const started = performance.now();
    const result = decisions({ command });

    expect(result).toContain('ask');
    expect(performance.now() - started).toBeLessThan(2000);
  });

  test('a line over the character cap is not read and asks; at the cap it is read', () => {
    const over = `echo ${'a'.repeat(ShellBudget.MAX_CHARS)}`;
    const at = `echo ${'a'.repeat(ShellBudget.MAX_CHARS - 5)}`;

    expect(parseShellChecked({ command: over })).toEqual({ commands: [], isOverBudget: true });
    expect(parseShellChecked({ command: at }).isOverBudget).toBe(false);
    expect(decisions({ command: over })).toEqual(['ask']);
  });

  test('a chain of env -S and eval over a megabyte asks at once', () => {
    const word = 'x'.repeat(1_000_000);
    const command = `env -S "env -S 'eval eval ${word}'"`;
    const started = performance.now();

    expect(decisions({ command })).toContain('ask');
    expect(performance.now() - started).toBeLessThan(1000);
  });

  test('more git or gh queries than the cap are not run; the line asks and a push in it is still denied', () => {
    const { run, calls } = counting();
    const result = decisions({
      command: `${'gh pr merge 410 -d; '.repeat(25)}git push -f origin main`,
      run,
    });

    expect(calls()).toBe(HookConstants.MAX_QUERIES);
    expect(result).toContain('ask');
    expect(result).toContain('deny');
  });

  test('a line within the query cap is not asked about', () => {
    const { run } = counting();

    expect(
      decisions({ command: `${'gh pr merge 410 -d; '.repeat(HookConstants.MAX_QUERIES)}ls`, run }),
    ).toEqual([]);
  });
});
