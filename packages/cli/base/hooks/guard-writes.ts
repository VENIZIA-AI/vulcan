/**
 * PreToolUse hook on Bash: catches the writes V-W-02 and V-W-03 reserve for a human, reading the
 * command and any local script it runs. It asks rather than denies (src/hooks/common/constants.ts).
 * The project's own deploy and migrate commands (`guard.writes.commands`) are read from the manifest and
 * checked beside the fixed list, inside compound commands too.
 * A script the project lists in `guard.writes.trustedScripts` is not read for writes while git says it
 * is tracked and unchanged; a config that cannot be read leaves the list empty, so every script is read.
 * An entry of `guard.writes.readOnlyScripts` in the manifest (the object form of `trustedScripts`, written by
 * `vulcan sync`) skips that read for the calls whose first argument after the script is one of its words.
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
  const { readGuardPolicy } = await import('../../src/hooks/project-guards.ts');
  const stdin = await Bun.stdin.text();
  const hookCommand = parseHookCommand({ text: stdin });
  const cwd = hookCommand?.cwd ?? process.cwd();
  let scripts: string[] = [];

  // Only a command that names a .ts file can use the list; the config loader (and zod) loads last, on its
  // own, and may fail alone.
  if (hookCommand && /\.ts\b/.test(hookCommand.command)) {
    try {
      const { loadConfig } = await import('../../src/config/index.ts');
      const loaded = await loadConfig({ root: process.env.CLAUDE_PROJECT_DIR ?? cwd });

      // The objects are the read-only entries: the manifest carries them, so only the paths count here.
      scripts = loaded.ok
        ? loaded.config.guard.writes.trustedScripts.filter(
            (entry): entry is string => typeof entry === 'string',
          )
        : [];
    } catch (error) {
      console.error(
        `vulcan: the guard-writes hook could not read the project config (${error instanceof Error ? error.message : String(error)}) - every script is read`,
      );
    }
  }

  const root = process.env.CLAUDE_PROJECT_DIR ?? cwd;
  const policy = readGuardPolicy({ root });
  const hits = hookCommand
    ? inspectCommand({
        command: hookCommand.command,
        cwd,
        trust: { root, scripts, readOnlyScripts: policy.readOnlyScripts },
        extra: policy.commands,
      })
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
