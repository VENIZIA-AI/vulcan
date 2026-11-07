/**
 * PreToolUse hook on Bash and file writes: asks when a file, worktree, clone or temp file would be
 * created outside the project (V-B-08). Stores a package manager, runtime or the agent tool manage
 * themselves are allowed - a default list, extended by `guard.toolOwnedPaths` in the project config.
 * `TMPDIR` or `mktemp` pointed at the system temp directory is not allowed.
 * It asks by default; `guard.outside: 'deny'` in the project config refuses instead, for agents where an ask can be
 * approved unseen. A write into the agent tool scratchpad is always denied.
 *
 * It guards against drift, not against an attacker, and a guard that blocks every call when its install
 * is broken costs more than it protects. So a missing package or `bun` passes (the settings wrapper says so on
 * stderr); input it cannot read ASKS, because nothing was checked. A guard that started and then failed - a crash or a
 * timeout, here an internal error or an unloadable module - ASKS instead of passing the call unchecked; a
 * manifest that cannot be read leaves the default allowlist. `VULCAN_GUARDS=off` switches it off,
 * read before anything is imported. It reads what the project set (`guard.outside`, `guard.toolOwnedPaths`)
 * from the manifest `vulcan sync` wrote, never from the config: a config a newer release wrote, which this
 * VULCAN cannot parse, then changes nothing here.
 */

// A module, so the awaits below are top-level; it has no static import, by design.
export {};

if (process.env.VULCAN_GUARDS === 'off') {
  process.exit(0);
}

const text = await Bun.stdin.text();

try {
  const { GuardDecisions } = await import('../../src/hooks/common/index.ts');
  const { HookDecision } = await import('../../src/hooks/decision.ts');
  const { OutsideGuard } = await import('../../src/hooks/guard-outside.ts');
  const { HookInput } = await import('../../src/hooks/hook-input.ts');
  const { ProjectTmp } = await import('../../src/hooks/project-tmp.ts');
  const { relative } = await import('node:path');
  const input = HookInput.parse({ text });

  if (!input) {
    console.log(
      JSON.stringify(
        HookDecision.buildTool({
          decision: GuardDecisions.ASK,
          reason: [
            'The hook input could not be read, so this call was not checked for files outside the project (V-B-08).',
            'Confirm only if the call stays inside the project.',
          ],
        }),
      ),
    );
  } else {
    const projectRoot = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
    const { ProjectGuards } = await import('../../src/hooks/project-guards.ts');
    const { toolOwnedPaths, outside } = ProjectGuards.readPolicy({ root: projectRoot });

    const hits = OutsideGuard.inspect({ input, projectRoot, toolOwnedPaths });

    if (hits.length > 0) {
      const isScratchpad = hits.some((hit) => hit.isAgentToolScratchpad);
      const hitLines = hits.map((hit) => `  - ${hit.message} (${hit.path})`);
      const tmpFolder = relative(projectRoot, ProjectTmp.projectOf({ root: projectRoot }));
      const places = `Scratch files go under ${tmpFolder}/<task>/ (worktrees under .agents/local/worktrees/, clones under .agents/local/clones/), never in /tmp or the home folder.`;

      const isDeny = isScratchpad || outside === GuardDecisions.DENY;
      let reason: string[];

      if (isScratchpad) {
        reason = [
          'This would write into the scratchpad folder the agent tool offers (V-B-08):',
          ...hitLines,
          '',
          `That folder is under /tmp, and V-B-08 overrides the tool line that says to use it. Nothing was written. ${places} Read a fetched file through a pipe (for example gh api ... | grep) rather than saving it.`,
        ];
      } else if (isDeny) {
        reason = [
          'This would create files outside the project (V-B-08), and this project denies it (guard.outside):',
          ...hitLines,
          '',
          `Nothing was written. ${places}`,
          'A store a tool manages itself can be allowed with guard.toolOwnedPaths in .configs/vulcan.config.*.',
        ];
      } else {
        reason = [
          'This would create files outside the project (V-B-08):',
          ...hitLines,
          '',
          `${places} Use that place, or confirm only if the owner asked for this exact path.`,
          'A store a tool manages itself can be allowed with guard.toolOwnedPaths in .configs/vulcan.config.*.',
        ];
      }

      console.log(
        JSON.stringify(
          HookDecision.buildTool({
            decision: isDeny ? GuardDecisions.DENY : GuardDecisions.ASK,
            reason,
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
