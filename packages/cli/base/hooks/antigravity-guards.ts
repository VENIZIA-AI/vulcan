/**
 * Antigravity's PreToolUse hook command (`.agents/hooks.json`, written by `vulcan sync`): reads the event
 * Antigravity sends (camelCase, `toolCall.name` and `toolCall.args`), runs the same guard scripts Claude Code
 * runs through the policy of `base/extensions/vulcan-guards.ts`, and prints Antigravity's answer:
 * `{ "decision": "allow" | "ask" | "deny", "reason": "..." }`. Input it cannot read is allowed, as in the
 * Claude hooks. The settings wrapper around it asks when this script crashes. `VULCAN_GUARDS=off` allows
 * everything, read before anything is imported.
 */

// A module, so the awaits below are top-level; it has no static import, by design.
export {};

const answer = (opts: { decision: string; reason?: string }): void => {
  console.log(JSON.stringify(opts));
};

if (process.env.VULCAN_GUARDS === 'off') {
  answer({ decision: 'allow' });
  process.exit(0);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const textOf = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

/** The Antigravity tools a guard covers, as the tool of the Claude guards. */
const TOOLS = new Map([
  ['run_command', 'bash'],
  ['write_to_file', 'write'],
  ['replace_file_content', 'edit'],
  ['multi_replace_file_content', 'edit'],
]);

const parseJson = (opts: { text: string }): unknown => {
  try {
    return JSON.parse(opts.text);
  } catch {
    return undefined;
  }
};

const stdin = await Bun.stdin.text();
const parsed = parseJson({ text: stdin });
const toolCall = isRecord(parsed) ? parsed.toolCall : undefined;
const args = isRecord(toolCall) ? toolCall.args : undefined;
const toolName = isRecord(toolCall) ? textOf(toolCall.name) : undefined;
const tool = toolName === undefined ? undefined : TOOLS.get(toolName);
const workspaces =
  isRecord(parsed) && Array.isArray(parsed.workspacePaths) ? parsed.workspacePaths : [];

if (tool === undefined || !isRecord(args)) {
  answer({ decision: 'allow' });
} else {
  const { verdictOf } = await import('../extensions/vulcan-guards.ts');
  const command = textOf(args.CommandLine);
  const path = textOf(args.TargetFile);
  const verdict = verdictOf({
    toolName: tool,
    input: Object.fromEntries([
      ['command', command],
      ['path', path],
    ]),
    cwd: textOf(args.Cwd) ?? textOf(workspaces[0]) ?? process.cwd(),
  });

  answer({ decision: verdict.kind, reason: verdict.reason === '' ? undefined : verdict.reason });
}
