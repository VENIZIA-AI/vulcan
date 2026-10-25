import { describe, expect, test } from 'bun:test';
import {
  buildGuardDecision,
  buildManifestDecision,
  buildPackageDecision,
  buildRemoteDecision,
  buildToolDecision,
  forHost,
  inspectManifestWrite,
  parseManifestHookInput,
} from '../../hooks/index.ts';

const ASK = {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'ask',
    permissionDecisionReason: 'confirm this',
  },
};

describe('forHost', () => {
  test('writes the decision and the reason at the top level too, for Copilot, and leaves hookSpecificOutput as it is', () => {
    const output = forHost({ output: ASK, env: {} });

    expect(output.hookSpecificOutput).toEqual(ASK.hookSpecificOutput);
    expect(output.permissionDecision).toBe('ask');
    expect(output.permissionDecisionReason).toBe('confirm this');
  });

  test('where Cursor says it runs the hook, an ask is a deny that says why; a deny stays a deny', () => {
    const asked = forHost({ output: ASK, env: { CURSOR_PROJECT_DIR: '/p' } });
    const denied = forHost({
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

  test('every builder of a PreToolUse decision goes through it', () => {
    const outputs = [
      buildToolDecision({ decision: 'ask', reason: ['x'] }),
      buildGuardDecision({ hits: [{ rule: 'V-W-03', message: 'deploy' }] }),
      buildManifestDecision(),
      buildPackageDecision({ verdict: { kind: 'deny', message: 'use add' } }),
      buildRemoteDecision({ hits: [{ rule: 'remote-hosts', message: 'ssh evil' }] }),
    ];

    for (const output of outputs) {
      expect(output).toHaveProperty('permissionDecision');
      expect(output).toHaveProperty('permissionDecisionReason');
    }
  });
});

describe('the shell tool of another host is read as Bash', () => {
  const eventOf = (tool: string): string =>
    JSON.stringify(
      Object.fromEntries([
        ['tool_name', tool],
        ['tool_input', { command: 'echo x > .agents/vulcan.manifest.json' }],
        ['cwd', '/p'],
      ]),
    );

  test.each(['Bash', 'Shell', 'shell', 'bash'])(
    '%s: a redirect onto the manifest is caught',
    (tool) => {
      const input = parseManifestHookInput({ text: eventOf(tool) });

      expect(input?.tool).toBe('Bash');
      expect(input !== undefined && inspectManifestWrite({ input })).toBe(true);
    },
  );

  test('Write and Edit keep their names', () => {
    expect(parseManifestHookInput({ text: eventOf('Write') })?.tool).toBe('Write');
    expect(parseManifestHookInput({ text: eventOf('Edit') })?.tool).toBe('Edit');
  });
});
