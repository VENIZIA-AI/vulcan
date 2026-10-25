import { describe, expect, test } from 'bun:test';
import { GUARD_HOOK_NAME, mergeGuardHook, removeGuardHook } from '../../agents/index.ts';

const parse = (text: string): Record<string, unknown> => JSON.parse(text);

describe('mergeGuardHook', () => {
  test('creates the file with one PreToolUse hook on the tools the guards cover', () => {
    const merged = mergeGuardHook({ text: undefined });

    expect(merged.ok).toBe(true);

    if (!merged.ok) {
      return;
    }

    expect(merged.changed).toBe(true);

    const entry = parse(merged.text)[GUARD_HOOK_NAME] as {
      PreToolUse: {
        matcher: string;
        hooks: { type: string; command: string; timeout: number }[];
      }[];
    };

    expect(Object.keys(parse(merged.text))).toEqual([GUARD_HOOK_NAME]);
    expect(entry.PreToolUse[0]?.matcher).toBe(
      'run_command|write_to_file|replace_file_content|multi_replace_file_content',
    );
    expect(entry.PreToolUse[0]?.hooks[0]?.type).toBe('command');
    expect(entry.PreToolUse[0]?.hooks[0]?.command).toContain('antigravity-guards.ts');
    expect(entry.PreToolUse[0]?.hooks[0]?.timeout).toBe(60);
  });

  test('keeps the hooks of the user and is idempotent', () => {
    const mine = { 'my-linter': { PostToolUse: [{ matcher: 'run_command', hooks: [] }] } };
    const first = mergeGuardHook({ text: JSON.stringify(mine) });

    if (!first.ok) {
      throw new Error(first.reason);
    }

    expect(first.changed).toBe(true);
    expect(Object.keys(parse(first.text))).toEqual(['my-linter', GUARD_HOOK_NAME]);
    expect(parse(first.text)['my-linter']).toEqual(mine['my-linter']);

    const second = mergeGuardHook({ text: first.text });

    expect(second.ok && second.changed).toBe(false);
  });

  test('replaces an out-of-date entry of its own', () => {
    const old = JSON.stringify({ [GUARD_HOOK_NAME]: { PreToolUse: [] } });
    const merged = mergeGuardHook({ text: old });

    expect(merged.ok && merged.changed).toBe(true);
  });

  test('a file that is not a JSON object is left as it is, with the reason', () => {
    for (const text of ['{ not json', '[]', '"text"', '42']) {
      const merged = mergeGuardHook({ text });

      expect(merged.ok, text).toBe(false);
    }
  });

  test('an empty file is treated as no file', () => {
    expect(mergeGuardHook({ text: '  \n' }).ok).toBe(true);
  });
});

describe('removeGuardHook', () => {
  test('takes its entry out and keeps the others', () => {
    const text = JSON.stringify({ 'my-linter': {}, [GUARD_HOOK_NAME]: {} });
    const removed = removeGuardHook({ text });

    expect(
      removed.ok && removed.outcome === 'removed' ? parse(removed.text ?? '{}') : undefined,
    ).toEqual({
      'my-linter': {},
    });
  });

  test('says there is no text left when nothing else was in the file', () => {
    const removed = removeGuardHook({ text: JSON.stringify({ [GUARD_HOOK_NAME]: {} }) });

    expect(removed).toEqual({ ok: true, outcome: 'removed', text: undefined });
  });

  test('is absent when the entry is not there, and refuses a file that is not JSON', () => {
    expect(removeGuardHook({ text: JSON.stringify({ other: {} }) })).toEqual({
      ok: true,
      outcome: 'absent',
    });
    expect(removeGuardHook({ text: 'nope' }).ok).toBe(false);
  });
});
