import { describe, expect, test } from 'bun:test';
import { HookInput } from '../../hooks/index.ts';

const ROOT = '/work/project';

/** The wire form Claude Code sends (snake_case), built as text so the names stay at this boundary. */
const wire = (opts: { tool: string; input: string; cwd?: string }): string =>
  `{"tool_name":${JSON.stringify(opts.tool)},"tool_input":${opts.input},"cwd":${JSON.stringify(opts.cwd ?? '/tmp')}}`;

describe('HookInput.parse', () => {
  test('reads the tool, the file path and the command from the wire form', () => {
    expect(
      HookInput.parse({
        text: wire({ tool: 'Write', input: '{"file_path":"a.json"}', cwd: ROOT }),
      }),
    ).toEqual({ tool: 'Write', filePath: 'a.json', command: undefined, cwd: ROOT });
  });

  test('a notebook edit carries notebook_path', () => {
    const input = HookInput.parse({
      text: wire({ tool: 'NotebookEdit', input: '{"notebook_path":"a.ipynb"}' }),
    });

    expect(input?.filePath).toBe('a.ipynb');
  });

  test('the shell tool of another host is read as Bash', () => {
    for (const tool of ['Shell', 'shell', 'bash']) {
      expect(HookInput.parse({ text: wire({ tool, input: '{"command":"ls"}' }) })).toEqual({
        tool: 'Bash',
        filePath: undefined,
        command: 'ls',
        cwd: '/tmp',
      });
    }
  });

  test('anything that is not a JSON object, or has no tool name, is not input', () => {
    expect(HookInput.parse({ text: 'not json' })).toBeUndefined();
    expect(HookInput.parse({ text: '[]' })).toBeUndefined();
    expect(HookInput.parse({ text: '{"tool_input":{}}' })).toBeUndefined();
  });
});
