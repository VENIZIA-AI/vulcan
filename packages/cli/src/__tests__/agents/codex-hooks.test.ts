import { describe, expect, test } from 'bun:test';
import { mergeCodexHooks, removeCodexHooks } from '../../agents/index.ts';

const parse = (text: string): Record<string, unknown> => JSON.parse(text);

const MINE = { matcher: 'Bash', hooks: [{ type: 'command', command: './my-check.sh' }] };

interface IFile {
  hooks: { PreToolUse: { matcher: string; hooks: { command: string; timeout?: number }[] }[] };
}

describe('mergeCodexHooks', () => {
  test('creates hooks.PreToolUse with one entry on the shell and the patch tool', () => {
    const merged = mergeCodexHooks({ text: undefined });

    if (!merged.ok) {
      throw new Error(merged.reason);
    }

    const file: IFile = JSON.parse(merged.text);

    expect(merged.changed).toBe(true);
    expect(file.hooks.PreToolUse).toHaveLength(1);
    expect(file.hooks.PreToolUse[0]?.matcher).toBe('Bash|apply_patch');
    expect(file.hooks.PreToolUse[0]?.hooks[0]?.command).toContain('codex-guards.ts');
    expect(file.hooks.PreToolUse[0]?.hooks[0]?.command).toContain('git rev-parse --show-toplevel');
    expect(file.hooks.PreToolUse[0]?.hooks[0]?.timeout).toBe(60);
  });

  test('keeps the hooks and the other events of the user, and is idempotent', () => {
    const mine = { hooks: { PreToolUse: [MINE], Stop: [{ hooks: [] }] }, other: 1 };
    const first = mergeCodexHooks({ text: JSON.stringify(mine) });

    if (!first.ok) {
      throw new Error(first.reason);
    }

    const file: IFile & { other: number; hooks: { Stop: unknown[] } } = JSON.parse(first.text);

    expect(file.hooks.PreToolUse).toHaveLength(2);
    expect(file.hooks.PreToolUse[0]).toEqual(MINE);
    expect(file.hooks.Stop).toHaveLength(1);
    expect(file.other).toBe(1);

    const second = mergeCodexHooks({ text: first.text });

    expect(second.ok && second.changed).toBe(false);
  });

  test('an out-of-date entry of its own is replaced in place, not added again', () => {
    const old = {
      hooks: {
        PreToolUse: [
          MINE,
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'bun old/codex-guards.ts' }] },
        ],
      },
    };
    const merged = mergeCodexHooks({ text: JSON.stringify(old) });

    if (!merged.ok) {
      throw new Error(merged.reason);
    }

    const file: IFile = JSON.parse(merged.text);

    expect(merged.changed).toBe(true);
    expect(file.hooks.PreToolUse).toHaveLength(2);
    expect(file.hooks.PreToolUse[1]?.matcher).toBe('Bash|apply_patch');
  });

  test('a file that is not what Codex reads is left, with the reason', () => {
    for (const text of ['{ nope', '[]', '{"hooks":[]}', '{"hooks":{"PreToolUse":{}}}']) {
      expect(mergeCodexHooks({ text }).ok, text).toBe(false);
    }
  });
});

describe('removeCodexHooks', () => {
  test('takes only its entry out and keeps the rest', () => {
    const merged = mergeCodexHooks({ text: JSON.stringify({ hooks: { PreToolUse: [MINE] } }) });

    if (!merged.ok) {
      throw new Error(merged.reason);
    }

    const removed = removeCodexHooks({ text: merged.text });

    expect(
      removed.ok && removed.outcome === 'removed' ? parse(removed.text ?? '{}') : undefined,
    ).toEqual({ hooks: { PreToolUse: [MINE] } });
  });

  test('says no text is left when nothing else was in the file, and is absent when it was not there', () => {
    const merged = mergeCodexHooks({ text: undefined });

    if (!merged.ok) {
      throw new Error(merged.reason);
    }

    expect(removeCodexHooks({ text: merged.text })).toEqual({
      ok: true,
      outcome: 'removed',
      text: undefined,
    });
    expect(removeCodexHooks({ text: JSON.stringify({ hooks: { PreToolUse: [MINE] } }) })).toEqual({
      ok: true,
      outcome: 'absent',
    });
    expect(removeCodexHooks({ text: 'nope' }).ok).toBe(false);
  });
});
