/**
 * PreToolUse hook on Bash and file writes: asks when a file, worktree, clone or temp file would be
 * created outside the project (V-B-08). Stores a package manager, runtime or the agent tool manage
 * themselves are allowed - a default list, extended by `guard.toolOwnedPaths` in the project config.
 * `TMPDIR` or `mktemp` pointed at the system temp directory is not allowed.
 * A write outside the project asks by default; `guard.outside: 'deny'` in the project config refuses instead, for agents
 * where an ask can be approved unseen. A write into the agent tool scratchpad is always denied. A part of the call it
 * cannot read (a program or a target named by a variable it cannot resolve, a line it cannot follow to its end) is always
 * DENIED, never asked: the agent can write the call again with a literal path, so a person is not stopped for it, and the
 * reason says how. Literal assignments of the same line (`S=dir; ... > $S/a`, `export X=dir`, `for i in 1 2`) are
 * resolved first, so the usual safe forms are read.
 *
 * A write to a file the guards read their policy from (the manifest, the config, `.claude/settings*.json` and the installed
 * package) is always DENIED: an agent that can write one can switch a guard off, and the owner changes them by hand or through
 * `vulcan project sync`. A missing package, `bun` or hook file is the settings wrapper's to answer: it blocks, bar `bun install` and
 * `vulcan project sync`.
 *
 * It guards against drift, not against an attacker. A hook input it cannot read ASKS, because nothing was checked and the agent
 * cannot repair that. A guard that started and then failed - a crash or a timeout, here an internal error or an unloadable
 * module - ASKS instead of passing the call unchecked. Where the project (`guard.asks: 'deny'`) or the launch environment
 * (`VULCAN_GUARD_ASKS=deny`) holds every ask, each is a deny; a manifest that exists and cannot be read holds them too. `VULCAN_GUARDS=off` switches it off,
 * read before anything is imported. It reads what the project set (`guard.outside`, `guard.toolOwnedPaths`)
 * from the manifest `vulcan project sync` wrote, never from the config: a config a newer release wrote, which this
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
  const { ProjectGuards } = await import('../../src/hooks/project-guards.ts');
  const input = HookInput.parse({ text });
  const projectRoot = process.env.CLAUDE_PROJECT_DIR ?? input?.cwd ?? process.cwd();
  const { toolOwnedPaths, configModules, outside, asks, asksNote } = ProjectGuards.readPolicy({
    root: projectRoot,
  });
  const isHeld = asks === GuardDecisions.DENY;

  if (!input) {
    console.log(
      JSON.stringify(
        HookDecision.buildTool({
          asks,
          asksNote,
          decision: GuardDecisions.ASK,
          reason: [
            'The hook input could not be read, so this call was not checked for files outside the project (V-B-08).',
            'Confirm only if the call stays inside the project.',
          ],
        }),
      ),
    );
  } else {
    const hits = OutsideGuard.inspect({ input, projectRoot, toolOwnedPaths, configModules });

    if (hits.length > 0) {
      const read = hits.filter((hit) => !hit.isUnread);
      const isScratchpad = read.some((hit) => hit.isAgentToolScratchpad);
      const linesOf = (list: typeof hits) => list.map((hit) => `  - ${hit.message} (${hit.path})`);
      const tmpFolder = relative(projectRoot, ProjectTmp.projectOf({ root: projectRoot }));
      const places = `Scratch files go under ${tmpFolder}/<task>/ (worktrees under .agents/local/worktrees/, clones under .agents/local/clones/), never in /tmp or the home folder.`;
      const owned =
        'A store a tool manages itself can be allowed with guard.toolOwnedPaths in .configs/vulcan.config.*.';

      // A line the check could not read is denied, whatever the project sets: the agent can write it again so that it is read.
      const unreadHits = hits.filter((hit) => hit.isUnread);
      const unread =
        unreadHits.length === 0
          ? []
          : [
              ...(read.length > 0 ? [''] : []),
              'Part of this call could not be read, so it was not checked for files outside the project (V-B-08):',
              ...linesOf(unreadHits),
            ];
      // A link to a path outside the project is a way to write there with a name inside it: denied, as the agent can copy or link inside.
      const linkHits = read.filter((hit) => hit.isLink === true);
      // A file the guards read their policy from: denied, so no agent loosens a guard by editing it.
      const protectedHits = read.filter((hit) => hit.isProtected === true);
      const isDeny =
        isScratchpad ||
        protectedHits.length > 0 ||
        linkHits.length > 0 ||
        unreadHits.length > 0 ||
        ((outside === GuardDecisions.DENY || isHeld) && read.length > 0);
      let reason: string[];

      if (unreadHits.length > 0 && !isScratchpad) {
        reason = [
          'Part of this call could not be read, so it cannot be checked for files outside the project (V-B-08):',
          ...linesOf(unreadHits),
          ...(read.length > 0
            ? [
                '',
                'The part that was read would also create files outside the project:',
                ...linesOf(read),
              ]
            : []),
          '',
          `Nothing was run. Write it again so the guard can read it: a literal path in every redirect (no $VAR or $(...) in a target; after a cd the guard cannot work out, an absolute path), a cd to a literal folder, the folder assigned on the same line (S=${tmpFolder}/x; ... > "$S/a") or named by a for loop over literal words; or put the script in a file under ${tmpFolder}/<task>/ and run it by that literal path (bun ${tmpFolder}/<task>/step.ts), with literal paths inside the project in its own redirects too: the guard does not read the script. ${places}`,
          owned,
        ];
      } else if (isScratchpad) {
        reason = [
          'This would write into the scratchpad folder the agent tool offers (V-B-08):',
          ...linesOf(read),
          ...unread,
          '',
          `That folder is under /tmp, and V-B-08 overrides the tool line that says to use it. Nothing was written. ${places} Read a fetched file through a pipe (for example gh api ... | grep) rather than saving it.`,
        ];
      } else if (protectedHits.length > 0) {
        reason = [
          'This would change a file the guards read their policy from (V-B-08):',
          ...linesOf(protectedHits),
          ...(read.length > protectedHits.length
            ? [
                '',
                'It would also create files outside the project:',
                ...linesOf(read.filter((hit) => hit.isProtected !== true)),
              ]
            : []),
          ...unread,
          '',
          'Nothing was run. These files are changed by the owner, by hand or through bun node_modules/.bin/vulcan project sync; an agent that could edit them could switch a guard off.',
        ];
      } else if (linkHits.length > 0) {
        reason = [
          'This would hard-link a path outside the project (V-B-08); a hard link cannot be told from the file, so a write through it changes that path later too:',
          ...linesOf(linkHits),
          ...(read.length > linkHits.length
            ? [
                '',
                'It would also create files outside the project:',
                ...linesOf(read.filter((hit) => hit.isLink !== true)),
              ]
            : []),
          '',
          `Nothing was run. Copy the file into the project (cp) instead of linking it, link a path inside the project, or make a symbolic link (ln -s), which is read once it exists. ${places}`,
          owned,
        ];
      } else if (isDeny) {
        reason = [
          `This would create files outside the project (V-B-08), and this project denies it (${isHeld ? 'guard.asks' : 'guard.outside'}):`,
          ...linesOf(read),
          ...unread,
          '',
          `Nothing was written. ${places}`,
          ...(isHeld && asksNote !== undefined ? ['', asksNote] : []),
          owned,
        ];
      } else {
        reason = [
          'This would create files outside the project (V-B-08):',
          ...linesOf(read),
          ...unread,
          '',
          `${places} Use that place, or confirm only if the owner asked for this exact path.`,
          owned,
        ];
      }

      console.log(
        JSON.stringify(
          HookDecision.buildTool({
            asks,
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

  // The imports may be what failed, so the answer is written by hand, and a project that sets guard.asks to deny is read from the manifest by hand too.
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
        // eslint-disable-next-line @venizia/no-silent-catch -- No .configs folder: no config, nothing to hold
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
          (typeof guard === 'object' && guard !== null && 'asks' in guard && guard.asks === 'deny');
        // eslint-disable-next-line @venizia/no-silent-catch -- A manifest that exists and cannot be read holds every ask
      } catch {
        isHeldOnCrash = true;
      }
    }
    // eslint-disable-next-line @venizia/no-silent-catch -- the crash path must still print its decision: a hold check that cannot run falls back to ask
  } catch {
    isHeldOnCrash = false;
  }

  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: isHeldOnCrash ? 'deny' : 'ask',
        permissionDecisionReason: [
          'The guard-outside hook failed, so this call was not checked for files outside the project (V-B-08):',
          `  - ${message}`,
          '',
          isHeldOnCrash
            ? 'This project denies every call that would need a human to confirm it (guard.asks: deny). Nothing was run: run bun install to repair the install.'
            : 'Confirm only if the call stays inside the project; run bun install to repair the install, or VULCAN_GUARDS=off to switch the guards off for a session.',
        ].join('\n'),
      },
    }),
  );
}
