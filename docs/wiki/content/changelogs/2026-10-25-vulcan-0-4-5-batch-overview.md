---
title: "VULCAN 0.4.5: The Guards Refuse More, Ask Less and Reach More Agents (Overview)"
description: The guards refuse more spellings of a forbidden command, ask less about data, ask instead of passing when they crash, and now run in Antigravity, Codex, omp, pi, Cursor and Copilot.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.5: the guards refuse more, ask less and reach more agents

<Badge type="danger" text="Security" /> <Badge type="warning" text="Behavior Change" /> <Badge type="tip" text="New Feature" /> <Badge type="warning" text="Not verified" />

**In one line.** The guards that read a command line stop more hidden force-pushes and writes, interrupt you less, and now protect six more agents.

## What changed

### The guards refuse more spellings of a forbidden command

These spellings hid a force-push or a write from the guards and are now read as the command they are:

- `env -S "git push -f origin main"` and `--split-string`
- `$'git' push -f origin main` (ANSI-C quoting)
- `xargs --eof git push -f origin main`
- a backslash before a newline
- a quote inside `$(...)`, and a quoted `<<`
- `watch 'git push -f origin main'`

A variable (`X=git; $X push`) is still not read. The guards stop accidental and drifting commands; they are not a sandbox.

### The guards ask less about data, and ask when they crash

- **Less noise.** `guard-writes` and `guard-remote-hosts` no longer ask about a heredoc written to a file (`cat > docs/deploy.md <<EOF ... kubectl apply ... EOF`) or the arguments of `rg`, `grep` and other read-only tools. A heredoc fed to a program that runs it (`bash <<EOF`, `ssh host <<EOF`) still asks. The `/tmp` ask now names `.agents/local/tmp/<task>/`.
- **Ask instead of pass.** If the `guard-git` or `guard-outside` hook crashes, is killed or runs past 30 seconds, it asks instead of letting the call through. On a broken install every `git` or `gh` command and every `guard-outside` call asks until you run `bun install`, or set `VULCAN_GUARDS=off` for the session. A missing `node_modules/@venizia/vulcan` or `bun` still passes, with a note on stderr.

### The guards run in more agents

- **Antigravity**, **omp** and **pi** get a guard file from `vulcan sync`. In Antigravity, `agy --dangerously-skip-permissions` approves an `ask`; a `deny` still holds.
- **Codex** gets a hook in `.codex/hooks.json`; **Cursor** and **Copilot** read the Claude hooks in `.claude/settings.json`.
- Codex and Cursor cannot ask on a tool call, so an `ask` is printed as a `deny` there.
- Codex, Cursor and Copilot follow their documentation and unit tests, not a real run: NOT VERIFIED.
- Pi was driven through its SDK with a scripted provider, not a real model. The `ask` dialog was not seen in a real terminal in omp, pi or Antigravity. Windows was not tried.

## Who is affected

Every project that syncs VULCAN gets the stricter and quieter guards. Users of the six agents above get the new guards.

## Upgrade steps

1. Update `@venizia/vulcan`. The parser fixes and the quieter guards load from `node_modules`.
2. Run `vulcan sync --agents <your list>`. It replaces the two hook wrappers in `.claude/settings.json` and writes the guard file of each agent you chose. `vulcan doctor` reports old wrappers as stale.
3. Codex: review and trust the hook in `/hooks`. Pi: start `pi` in the project and trust it.
