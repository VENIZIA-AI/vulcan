/**
 * PreToolUse hook on Bash: parses the command (quotes, `&&`, `;`, `git -C`, heredocs) and catches the git
 * and gh actions that lose history or a protected branch - deleting, renaming or force-pushing develop
 * or main, `gh pr merge --delete-branch` on a pull request whose head is one of them (deny), and
 * `reset --hard`, other force-pushes and `branch -D` of an unmerged branch (ask).
 *
 * It fails OPEN: it guards against drift, it is not the last line of defence, and a guard that blocks
 * every command when it breaks costs more than it protects. Input it cannot read, a missing module or an
 * internal error pass the call with a note on stderr. `VULCAN_GUARDS=off` switches it off, read before
 * anything is imported. It imports only the modules it needs - no config, no zod.
 */

// A module, so the awaits below are top-level; it has no static import, by design.
export {};

if (process.env.VULCAN_GUARDS === 'off') {
  process.exit(0);
}

try {
  const { GuardDecisions } = await import('../../src/hooks/common/index.ts');
  const { buildToolDecision } = await import('../../src/hooks/decision.ts');
  const { inspectGit } = await import('../../src/hooks/guard-git.ts');
  const { parseHookCommand } = await import('../../src/hooks/guard-writes.ts');
  const hookCommand = parseHookCommand({ text: await Bun.stdin.text() });
  const hits = hookCommand
    ? inspectGit({ command: hookCommand.command, cwd: hookCommand.cwd ?? process.cwd() })
    : [];

  if (hits.length > 0) {
    const denied = hits.some((hit) => hit.decision === GuardDecisions.DENY);

    console.log(
      JSON.stringify(
        buildToolDecision({
          decision: denied ? GuardDecisions.DENY : GuardDecisions.ASK,
          reason: [
            denied
              ? 'This command is refused by the base rules:'
              : 'This command needs a human to confirm:',
            ...hits.map((hit) => `  - ${hit.rule}: ${hit.message}`),
            '',
            denied
              ? 'Hand the exact command to the owner instead (V-W-06); VULCAN_GUARDS=off switches the guards off for a session.'
              : 'Confirm only if the owner asked for exactly this.',
          ],
        }),
      ),
    );
  }
} catch (error) {
  console.error(
    `vulcan: the guard-git hook failed (${error instanceof Error ? error.message : String(error)}) - the call passes; run bun install`,
  );
}
