/**
 * PreToolUse hook on Bash: parses the command (quotes, `&&`, `;`, `git -C`, heredocs) and catches the git
 * and gh actions that lose history or a protected branch - deleting, renaming or force-pushing develop
 * or main, `gh pr merge --delete-branch` on a pull request whose head is one of them (deny), and
 * `reset --hard`, other force-pushes and `branch -D` of an unmerged branch (ask).
 *
 * It guards against drift, it is not the last line of defence, and a guard that blocks every command when
 * its install is broken costs more than it protects. So input it cannot read passes, and so does a missing
 * package or `bun` (the settings wrapper says so on stderr). A guard that started and then failed - a crash
 * or a timeout, here an internal error or an unloadable module - ASKS about a command that names `git` or
 * `gh`, instead of passing it unchecked. `VULCAN_GUARDS=off` switches it off, read before anything is
 * imported. It imports only the modules it needs - no config, no zod. The branches the project lists in
 * `guard.git.askPush` are read from the manifest, and a plain push to one of them asks.
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
  const { inspectGit } = await import('../../src/hooks/guard-git.ts');
  const { parseHookCommand } = await import('../../src/hooks/guard-writes.ts');
  const { readGuardPolicy } = await import('../../src/hooks/project-guards.ts');
  const hookCommand = parseHookCommand({ text });
  const cwd = hookCommand?.cwd ?? process.cwd();
  const hits = hookCommand
    ? inspectGit({
        command: hookCommand.command,
        cwd,
        askPush: readGuardPolicy({ root: process.env.CLAUDE_PROJECT_DIR ?? cwd }).askPush,
      })
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
  const message = error instanceof Error ? error.message : String(error);

  console.error(`vulcan: the guard-git hook failed (${message}); run bun install`);

  // The imports may be what failed, so the answer is written by hand: no module is needed to ask.
  if (/(^|[^A-Za-z0-9_])(git|gh)([^A-Za-z0-9_]|$)/.test(text)) {
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'ask',
          permissionDecisionReason: [
            'The guard-git hook failed, so this command was not checked:',
            `  - ${message}`,
            '',
            'Confirm only if the owner asked for exactly this; run bun install to repair the install, or VULCAN_GUARDS=off to switch the guards off for a session.',
          ].join('\n'),
        },
      }),
    );
  }
}
