/**
 * PreToolUse hook on Bash and file writes: asks when a file, worktree, clone or temp file would be
 * created outside the project (V-B-08). Stores a package manager, runtime or the agent tool manage
 * themselves are allowed - a default list, extended by `guard.toolOwnedPaths` in the project config.
 * `TMPDIR` or `mktemp` pointed at the system temp directory is not allowed. `VULCAN_GUARDS=off`
 * switches it off for the session; input it cannot read passes.
 *
 * It fails closed: Claude Code blocks a PreToolUse call only on exit 2. The modules load inside the try.
 */

// A module, so the awaits below are top-level; it has no static import, by design.
export {};

try {
  const {
    buildToolDecision,
    GuardDecisions,
    guardsAreOff,
    inspectOutside,
    parseManifestHookInput,
  } = await import('../../src/hooks/index.ts');
  const { loadConfig } = await import('../../src/config/index.ts');
  const input = parseManifestHookInput({ text: await Bun.stdin.text() });

  if (input && !guardsAreOff()) {
    const projectRoot = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
    const loaded = await loadConfig({ root: projectRoot });
    const hits = inspectOutside({
      input,
      projectRoot,
      toolOwnedPaths: loaded.ok ? loaded.config.guard.toolOwnedPaths : [],
    });

    if (hits.length > 0) {
      console.log(
        JSON.stringify(
          buildToolDecision({
            decision: GuardDecisions.ASK,
            reason: [
              'This would create files outside the project (V-B-08):',
              ...hits.map((hit) => `  - ${hit.message} (${hit.path})`),
              '',
              'Everything an agent creates lives under .agents/local/ (tmp/, worktrees/, clones/). Use it, or confirm if the owner asked for this exact path.',
              'A store a tool manages itself can be allowed with guard.toolOwnedPaths in .configs/vulcan.config.*.',
            ],
          }),
        ),
      );
    }
  }
} catch (error) {
  console.error(
    `vulcan: the guard-outside hook failed (${error instanceof Error ? error.message : String(error)}) - blocked; run bun install`,
  );
  process.exit(2);
}
