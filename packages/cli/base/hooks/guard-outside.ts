/**
 * PreToolUse hook on Bash and file writes: asks when a file, worktree, clone or temp file would be
 * created outside the project (V-B-08). Stores a package manager, runtime or the agent tool manage
 * themselves are allowed - a default list, extended by `guard.toolOwnedPaths` in the project config.
 * `TMPDIR` or `mktemp` pointed at the system temp directory is not allowed.
 *
 * It guards against drift, not against an attacker, and a guard that blocks every call when its install
 * is broken costs more than it protects. So input it cannot read passes, and so does a missing package or
 * `bun` (the settings wrapper says so on stderr). A guard that started and then failed - a crash or a
 * timeout, here an internal error or an unloadable module - ASKS instead of passing the call unchecked; a
 * project config that cannot be read leaves the default allowlist. `VULCAN_GUARDS=off` switches it off,
 * read before anything is imported. It imports only the modules it needs - the config loader (and zod) is
 * loaded on its own, last, and may fail alone.
 */

// A module, so the awaits below are top-level; it has no static import, by design.
export {};

if (process.env.VULCAN_GUARDS === 'off') {
  process.exit(0);
}

const text = await Bun.stdin.text();

try {
  const { GuardDecisions } = await import('../../src/hooks/common/index.ts');
  const { buildToolDecision } = await import('../../src/hooks/decision.ts');
  const { inspectOutside } = await import('../../src/hooks/guard-outside.ts');
  const { parseManifestHookInput } = await import('../../src/hooks/guard-manifest.ts');
  const input = parseManifestHookInput({ text });

  if (input) {
    const projectRoot = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
    let toolOwnedPaths: string[] = [];

    try {
      const { loadConfig } = await import('../../src/config/index.ts');
      const loaded = await loadConfig({ root: projectRoot });

      toolOwnedPaths = loaded.ok ? loaded.config.guard.toolOwnedPaths : [];
    } catch (error) {
      console.error(
        `vulcan: the guard-outside hook could not read the project config (${error instanceof Error ? error.message : String(error)}) - the default allowlist applies`,
      );
    }

    const hits = inspectOutside({ input, projectRoot, toolOwnedPaths });

    if (hits.length > 0) {
      console.log(
        JSON.stringify(
          buildToolDecision({
            decision: GuardDecisions.ASK,
            reason: [
              'This would create files outside the project (V-B-08):',
              ...hits.map((hit) => `  - ${hit.message} (${hit.path})`),
              '',
              'Scratch files go under .agents/local/tmp/<task>/ (worktrees under .agents/local/worktrees/, clones under .agents/local/clones/), never in /tmp or the home folder. Use that place, or confirm only if the owner asked for this exact path.',
              'A store a tool manages itself can be allowed with guard.toolOwnedPaths in .configs/vulcan.config.*.',
            ],
          }),
        ),
      );
    }
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`vulcan: the guard-outside hook failed (${message}); run bun install`);

  // The imports may be what failed, so the answer is written by hand: no module is needed to ask.
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: [
          'The guard-outside hook failed, so this call was not checked for files outside the project (V-B-08):',
          `  - ${message}`,
          '',
          'Confirm only if the call stays inside the project; run bun install to repair the install, or VULCAN_GUARDS=off to switch the guards off for a session.',
        ].join('\n'),
      },
    }),
  );
}
