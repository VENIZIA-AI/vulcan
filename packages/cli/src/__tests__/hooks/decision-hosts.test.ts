import { describe, expect, test } from 'bun:test';
import { HookDecision, HookInput, WriteGuard } from '../../hooks/index.ts';

const ASK = {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'ask',
    permissionDecisionReason: 'confirm this',
  },
};

describe('forHost', () => {
  test('writes the decision and the reason at the top level too, for Copilot, and leaves hookSpecificOutput as it is', () => {
    const output = HookDecision.forHost({ output: ASK, env: {} });

    expect(output.hookSpecificOutput).toEqual(ASK.hookSpecificOutput);
    expect(output.permissionDecision).toBe('ask');
    expect(output.permissionDecisionReason).toBe('confirm this');
  });

  test('where Cursor says it runs the hook, an ask is a deny that says why; a deny stays a deny', () => {
    const asked = HookDecision.forHost({ output: ASK, env: { CURSOR_PROJECT_DIR: '/p' } });
    const denied = HookDecision.forHost({
      output: {
        hookSpecificOutput: { ...ASK.hookSpecificOutput, permissionDecision: 'deny' },
      },
      env: { CURSOR_PROJECT_DIR: '/p' },
    });

    expect(asked.permissionDecision).toBe('deny');
    expect(asked.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(asked.permissionDecisionReason).toContain('Cursor cannot ask about a tool call');
    expect(denied.permissionDecisionReason).toBe('confirm this');
  });

  test('with asks set to deny, an ask is a deny that says why; a deny stays one and asks set to ask changes nothing', () => {
    const held = HookDecision.forHost({ output: ASK, env: {}, asks: 'deny' });
    const kept = HookDecision.forHost({ output: ASK, env: {}, asks: 'ask' });
    const denied = HookDecision.forHost({
      output: { hookSpecificOutput: { ...ASK.hookSpecificOutput, permissionDecision: 'deny' } },
      env: {},
      asks: 'deny',
    });

    expect(held.permissionDecision).toBe('deny');
    expect(held.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(held.permissionDecisionReason).toContain('confirm this');
    expect(held.permissionDecisionReason).toContain('guard.asks: deny');
    expect(kept.permissionDecision).toBe('ask');
    expect(kept.permissionDecisionReason).toBe('confirm this');
    expect(denied.permissionDecisionReason).toBe('confirm this');
  });

  test('the line added to a held ask is the one the project gave', () => {
    const held = HookDecision.forHost({
      output: ASK,
      env: {},
      asks: 'deny',
      asksNote: 'held by the environment',
    });

    expect(held.permissionDecisionReason).toBe('confirm this\n\nheld by the environment');
  });

  test('every builder of a PreToolUse decision goes through it', () => {
    const outputs = [
      HookDecision.buildTool({ decision: 'ask', reason: ['x'] }),
      WriteGuard.buildDecision({ hits: [{ rule: 'V-W-03', message: 'deploy' }] }),
    ];

    for (const output of outputs) {
      expect(output).toHaveProperty('permissionDecision');
      expect(output).toHaveProperty('permissionDecisionReason');
    }

    // and both builders hold an ask when the project says so
    expect(
      HookDecision.buildTool({ decision: 'ask', reason: ['x'], asks: 'deny' }).permissionDecision,
    ).toBe('deny');
    expect(
      WriteGuard.buildDecision({ hits: [{ rule: 'V-W-03', message: 'deploy' }], asks: 'deny' })
        .permissionDecision,
    ).toBe('deny');
  });
});

describe('the shell tool of another host is read as Bash', () => {
  const eventOf = (tool: string): string =>
    JSON.stringify(
      Object.fromEntries([
        ['tool_name', tool],
        ['tool_input', { command: 'echo x > notes.txt' }],
        ['cwd', '/p'],
      ]),
    );

  test.each(['Bash', 'Shell', 'shell', 'bash'])('%s: read as Bash, the command kept', (tool) => {
    const input = HookInput.parse({ text: eventOf(tool) });

    expect(input?.tool).toBe('Bash');
    expect(input?.command).toBe('echo x > notes.txt');
  });

  test('Write and Edit keep their names', () => {
    expect(HookInput.parse({ text: eventOf('Write') })?.tool).toBe('Write');
    expect(HookInput.parse({ text: eventOf('Edit') })?.tool).toBe('Edit');
  });
});
