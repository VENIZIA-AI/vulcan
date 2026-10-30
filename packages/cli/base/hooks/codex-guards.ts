/**
 * Codex's PreToolUse hook command (`.codex/hooks.json`, written by `vulcan sync`): reads the event Codex
 * sends (`tool_name`, `tool_input.command`, `cwd`), runs the same guard scripts Claude Code runs through the
 * policy of `base/extensions/vulcan-guards.ts`, and prints Codex's deny. Codex cannot ask about a tool call
 * (an `ask` marks the hook failed and the call continues), so an ask is printed as a deny that says a human
 * must confirm. An `apply_patch` is read file by file: `*** Add File:` is a write, the other headers are
 * edits. No output allows. Input it cannot read is allowed. `VULCAN_GUARDS=off` allows everything, read
 * before anything is imported.
 */

// A module, so the awaits below are top-level; it has no static import, by design.
export {};

if (process.env.VULCAN_GUARDS === 'off') {
  process.exit(0);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const textOf = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

const parseJson = (opts: { text: string }): unknown => {
  try {
    return JSON.parse(opts.text);
  } catch {
    return undefined;
  }
};

const stdin = await Bun.stdin.text();
const parsed = parseJson({ text: stdin });
const toolInput = isRecord(parsed) ? parsed['tool_input'] : undefined;
const tool = isRecord(parsed) ? textOf(parsed['tool_name']) : undefined;
const command = isRecord(toolInput) ? textOf(toolInput['command']) : undefined;
const cwd = (isRecord(parsed) ? textOf(parsed['cwd']) : undefined) ?? process.cwd();

if (command !== undefined && (tool === 'Bash' || tool === 'apply_patch')) {
  const { verdictOf } = await import('../extensions/vulcan-guards.ts');
  const { patchedFilesOf } = await import('../../src/hooks/codex-patch.ts');
  const verdicts =
    tool === 'Bash'
      ? [verdictOf({ toolName: 'bash', input: Object.fromEntries([['command', command]]), cwd })]
      : patchedFilesOf({ patch: command, cwd }).map((file) =>
          verdictOf({ toolName: file.tool, input: Object.fromEntries([['path', file.path]]), cwd }),
        );
  const refused = verdicts.find((verdict) => verdict.kind === 'deny');
  const asked = verdicts.filter((verdict) => verdict.kind === 'ask');
  const reason =
    refused?.reason ??
    (asked.length > 0
      ? `${asked.map((verdict) => verdict.reason).join('\n\n')}\n(Codex cannot ask about a tool call: a human must confirm this)`
      : undefined);

  if (reason !== undefined) {
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: reason,
        },
      }),
    );
  }
}
