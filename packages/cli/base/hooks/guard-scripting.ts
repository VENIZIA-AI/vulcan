/**
 * PreToolUse hook on Bash: when the command runs python, python3 or pip (read with the shell parser of
 * guard-git, so a message or an argument that only mentions python is not one) it adds one line to the
 * model's context - agent scripting uses bun by default, another language is fine when the task needs
 * it (V-B-09) - and lets the call through. It never asks and never blocks.
 *
 * It fails OPEN: an advice is not worth a stopped session. Input it cannot read, a missing module or an
 * internal error pass the call with a note on stderr. `VULCAN_GUARDS=off` switches it off, read before
 * anything is imported. It imports only the modules it needs - no config, no zod.
 */

// A module, so the awaits below are top-level; it has no static import, by design.
export {};

if (process.env.VULCAN_GUARDS === 'off') {
  process.exit(0);
}

try {
  const { buildScriptingAdvice, inspectScripting } =
    await import('../../src/hooks/guard-scripting.ts');
  const { parseHookCommand } = await import('../../src/hooks/guard-writes.ts');
  const hookCommand = parseHookCommand({ text: await Bun.stdin.text() });

  if (hookCommand && inspectScripting({ command: hookCommand.command }).length > 0) {
    console.log(JSON.stringify(buildScriptingAdvice()));
  }
} catch (error) {
  console.error(
    `vulcan: the guard-scripting hook failed (${error instanceof Error ? error.message : String(error)}) - the call passes; run bun install`,
  );
}
