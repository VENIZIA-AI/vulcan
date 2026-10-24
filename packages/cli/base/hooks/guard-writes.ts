/**
 * PreToolUse hook on Bash: catches the writes V-W-02 and V-W-03 reserve for a human, reading the
 * command and any local script it runs. It asks rather than denies (src/hooks/common/constants.ts).
 *
 * It fails closed: Claude Code blocks a PreToolUse call only on exit 2, so a hook that throws - a
 * partial install, say, where its own modules are missing - would let every command through. The
 * modules load inside the try for that reason.
 */

// A module, so the awaits below are top-level; it has no static import, by design.
export {};

try {
  const { buildGuardDecision, inspectCommand, parseHookCommand } =
    await import('../../src/hooks/guard-writes.ts');
  const hookCommand = parseHookCommand({ text: await Bun.stdin.text() });
  const hits = hookCommand
    ? inspectCommand({ command: hookCommand.command, cwd: hookCommand.cwd ?? process.cwd() })
    : [];

  if (hits.length > 0) {
    console.log(JSON.stringify(buildGuardDecision({ hits })));
  }
} catch (error) {
  console.error(
    `vulcan: the guard-writes hook failed (${error instanceof Error ? error.message : String(error)}) - blocked; run bun install`,
  );
  process.exit(2);
}
