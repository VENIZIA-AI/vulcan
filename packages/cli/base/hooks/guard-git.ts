/**
 * PreToolUse hook on Bash: parses the command (quotes, `&&`, `;`, `git -C`) and catches the git and gh
 * actions that lose history or a protected branch - deleting or force-pushing develop or main,
 * `gh pr merge --delete-branch` on a pull request whose head is one of them (deny), and `reset --hard`,
 * other force-pushes and `branch -D` of an unmerged branch (ask). Input it cannot read passes.
 * `VULCAN_GUARDS=off` switches it off for the session.
 *
 * It fails closed: Claude Code blocks a PreToolUse call only on exit 2, so a hook that throws - a
 * partial install, say - would let every command through. The modules load inside the try.
 */

// A module, so the awaits below are top-level; it has no static import, by design.
export {};

// Read before anything is imported: a broken install must not take the way out with it.
if (process.env.VULCAN_GUARDS === 'off') {
  process.exit(0);
}

try {
  const { buildToolDecision, GuardDecisions, guardsAreOff, inspectGit, parseHookCommand } =
    await import('../../src/hooks/index.ts');
  const hookCommand = parseHookCommand({ text: await Bun.stdin.text() });
  const hits =
    hookCommand && !guardsAreOff()
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
    `vulcan: the guard-git hook failed (${error instanceof Error ? error.message : String(error)}) - blocked; run bun install`,
  );
  process.exit(2);
}
