import { join } from 'node:path';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';
import { expect } from 'bun:test';

const HOOK = join(import.meta.dir, '..', '..', 'base', 'hooks', 'guard-manifest.ts');

export const ROOT = '/work/project';
export const MANIFEST = '.agents/vulcan.manifest.json';
export const FILE_KEY = 'file_path';

/** The wire form Claude Code sends (snake_case), built as text so the names stay at this boundary. */
export const wire = (opts: { tool: string; input: string; cwd?: string }): string =>
  `{"tool_name":${JSON.stringify(opts.tool)},"tool_input":${opts.input},"cwd":${JSON.stringify(opts.cwd ?? '/tmp')}}`;

export const runHook = (opts: { payload: string }) => {
  const child = spawnSyncBounded({
    cmd: [process.execPath, HOOK],
    cwd: '/tmp',
    stdin: new Blob([opts.payload]),
    stdout: 'pipe',
    stderr: 'pipe',
  });

  return { code: child.exitCode, stdout: child.stdout.toString(), stderr: child.stderr.toString() };
};

/** What the hook answers for a tool call: `deny`, or `undefined` when it prints nothing and lets the call through. */
export const answerOf = (opts: {
  tool: string;
  input: Record<string, unknown>;
  cwd?: string;
}): string | undefined => {
  const result = runHook({
    payload: wire({ tool: opts.tool, input: JSON.stringify(opts.input), cwd: opts.cwd }),
  });

  expect(result.code).toBe(0);

  return result.stdout === ''
    ? undefined
    : JSON.parse(result.stdout).hookSpecificOutput.permissionDecision;
};

export const answerToCommand = (opts: { command: string; cwd?: string }): string | undefined =>
  answerOf({ tool: 'Bash', input: { command: opts.command }, cwd: opts.cwd });
