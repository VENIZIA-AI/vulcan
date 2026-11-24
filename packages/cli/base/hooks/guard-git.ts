/**
 * PreToolUse hook on Bash: parses the command (quotes, `&&`, `;`, `git -C`, heredocs) and catches the git
 * and gh actions that lose history or a protected branch - deleting, renaming or force-pushing develop
 * or main, `gh pr merge --delete-branch` on a pull request whose head is one of them (deny), and
 * `reset --hard`, other force-pushes, `branch -D` of an unmerged branch and `gh pr create` with no `--base`
 * (ask: the pull request would land on the default branch).
 *
 * It guards against drift, it is not the last line of defence. A missing package, `bun` or hook file is the settings wrapper's
 * to answer: it blocks a command that names `git` or `gh`, bar `bun install` and `vulcan sync`. Input it cannot read ASKS,
 * because nothing was checked. A guard that started and then failed - a crash or a timeout, here an internal error or an
 * unloadable module - ASKS about a command that names `git` or `gh`, instead of passing it unchecked. Where the project
 * (`guard.asks: 'deny'`) or the launch environment (`VULCAN_GUARD_ASKS=deny`) holds every ask, each ask is a deny, and so is a
 * crash when the manifest exists and cannot be read. `VULCAN_GUARDS=off` switches it off, read before anything is
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
  const { HookDecision } = await import('../../src/hooks/decision.ts');
  const { GitGuard } = await import('../../src/hooks/guard-git.ts');
  const { FlowGuard } = await import('../../src/hooks/flow-guard.ts');
  const { PackageSwap } = await import('../../src/hooks/package-swap.ts');
  const { RunnerGuard } = await import('../../src/hooks/guard-runner.ts');
  const { WriteGuard } = await import('../../src/hooks/guard-writes.ts');
  const { ProjectGuards } = await import('../../src/hooks/project-guards.ts');
  const hookCommand = WriteGuard.parseHookCommand({ text });
  const cwd = hookCommand?.cwd ?? process.cwd();
  const root = process.env.CLAUDE_PROJECT_DIR ?? cwd;
  const policy = ProjectGuards.readPolicy({ root });
  // V-P-13 exists only in a project that logs events, and only for a line that names git, gh or glab: a project with the log
  // off never loads the events module or the board's fold, and a rule that cannot load is no hit, never an ask.
  let flowHits: Awaited<ReturnType<typeof GitGuard.inspect>> = [];

  if (hookCommand && /\b(git|gh|glab)\b/.test(hookCommand.command)) {
    try {
      const { EventSettings } = await import('../../src/events/settings.ts');

      if (EventSettings.read({ root }).log) {
        const state = await import('../../src/events/flow-state.ts');

        flowHits = FlowGuard.inspect({
          root,
          command: hookCommand.command,
          cwd,
          sessionId: hookCommand.sessionId,
          env: process.env,
          isOver: state.FlowState.isOver,
        });
      }
    } catch {
      flowHits = [];
    }
  }

  const hits = hookCommand
    ? [
        ...GitGuard.inspect({ command: hookCommand.command, cwd, askPush: policy.askPush }),
        ...flowHits,
        ...RunnerGuard.inspect({ command: hookCommand.command, cwd, allow: policy.runnersAllow }),
        ...PackageSwap.inspectCommand({ command: hookCommand.command, cwd }),
      ]
    : [
        {
          rule: 'V-W-01',
          message: 'the hook input could not be read, so the command was not checked',
          decision: GuardDecisions.ASK,
          fix: undefined,
        },
      ];

  if (hits.length > 0) {
    const denied = hits.some((hit) => hit.decision === GuardDecisions.DENY);
    // A project that sets guard.asks to deny refuses what would ask a human, with the owner to hand it to.
    const isHeld = !denied && policy.asks === GuardDecisions.DENY;
    // A denial the agent can repair says how; one that is the owner's to decide is handed to the owner.
    const fixes = [
      ...new Set(
        hits.flatMap((hit) =>
          hit.decision === GuardDecisions.DENY && hit.fix !== undefined ? [hit.fix] : [],
        ),
      ),
    ];
    const isOwners = hits.some(
      (hit) => hit.decision === GuardDecisions.DENY && hit.fix === undefined,
    );

    console.log(
      JSON.stringify(
        HookDecision.buildTool({
          asks: policy.asks,
          asksNote: policy.asksNote,
          decision: denied || isHeld ? GuardDecisions.DENY : GuardDecisions.ASK,
          reason: [
            denied
              ? 'This command is refused by the base rules:'
              : isHeld
                ? 'This command needs a human to confirm, and every ask is denied here:'
                : 'This command needs a human to confirm:',
            ...hits.map((hit) => `  - ${hit.rule}: ${hit.message}`),
            '',
            ...(denied
              ? [
                  ...(fixes.length > 0
                    ? [`Nothing was run. Write it again: ${fixes.join('; ')}.`]
                    : []),
                  ...(isOwners || fixes.length === 0
                    ? [
                        'Hand the exact command to the owner instead (V-W-06); VULCAN_GUARDS=off switches the guards off for a session.',
                      ]
                    : []),
                ]
              : isHeld
                ? [
                    'Nothing was run. Hand the exact command to the owner instead (V-W-06).',
                    ...(policy.asksNote === undefined ? [] : [policy.asksNote]),
                  ]
                : ['Confirm only if the owner asked for exactly this.']),
          ],
        }),
      ),
    );
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`vulcan: the guard-git hook failed (${message}); run bun install`);

  // The imports may be what failed, so the answer is written by hand, and a project that sets guard.asks to deny is read from the manifest by hand too.
  if (/(^|[^A-Za-z0-9_])(git|gh)([^A-Za-z0-9_]|$)/.test(text)) {
    let isHeldOnCrash = false;

    try {
      const { existsSync, readFileSync } = await import('node:fs');
      const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
      const file = `${root}/.agents/local/vulcan.manifest.json`;

      isHeldOnCrash = process.env.VULCAN_GUARD_ASKS === 'deny';

      if (!isHeldOnCrash && !existsSync(file)) {
        // No local manifest in a project that has a config: a clone that did not sync is held like an unreadable manifest.
        const { readdirSync } = await import('node:fs');

        try {
          isHeldOnCrash = readdirSync(`${root}/.configs`).some((name) =>
            name.startsWith('vulcan.config.'),
          );
        } catch {
          // No .configs folder: no config, nothing to hold.
        }
      }

      if (!isHeldOnCrash && existsSync(file)) {
        try {
          const manifest: unknown = JSON.parse(readFileSync(file, 'utf8'));
          const guard =
            typeof manifest === 'object' && manifest !== null && 'guard' in manifest
              ? manifest.guard
              : undefined;

          isHeldOnCrash =
            typeof manifest !== 'object' ||
            manifest === null ||
            Array.isArray(manifest) ||
            (typeof guard === 'object' &&
              guard !== null &&
              'asks' in guard &&
              guard.asks === 'deny');
        } catch {
          // A manifest that exists and cannot be read holds every ask.
          isHeldOnCrash = true;
        }
      }
    } catch {
      isHeldOnCrash = false;
    }

    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: isHeldOnCrash ? 'deny' : 'ask',
          permissionDecisionReason: [
            'The guard-git hook failed, so this command was not checked:',
            `  - ${message}`,
            '',
            isHeldOnCrash
              ? 'This project denies every call that would need a human to confirm it (guard.asks: deny). Nothing was run: run bun install to repair the install.'
              : 'Confirm only if the owner asked for exactly this; run bun install to repair the install, or VULCAN_GUARDS=off to switch the guards off for a session.',
          ].join('\n'),
        },
      }),
    );
  }
}
