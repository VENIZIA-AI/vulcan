---
title: "VULCAN X.Y.Z: List Your Own Deploy, Migrate and Push Targets for the Guards"
description: A project can list the commands and push targets its guards ask about, found inside compound commands too, so the guards cover more than a fixed list.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-27

## VULCAN X.Y.Z: list your own deploy, migrate and push targets for the guards

<Badge type="danger" text="Security" /> <Badge type="tip" text="Enhancement" />

**In one line.** Your deploy and migrate commands and your push branches, such as `make deploy-develop-x`, `bun run migrate:up` and `git push origin develop`, can now make the guards ask.

## What changed

- **`guard.writes.commands`.** A list of `{ rule, what, pattern }`: `rule` is `V-W-02` or `V-W-03`, `what` names the action, `pattern` is a JavaScript regular expression (`ignoreCase: true` for the other spelling). A matching command asks, with the rule and `<what> (this project's pattern)`.
- **`guard.git.askPush`.** Branch names, with `*` for any run of characters. A plain `git push` to one of them asks, including a bare `git push` on that branch and `HEAD:release/1.2`. A force-push or a delete of `develop` or `main` is still denied.
- **Found inside compound commands.** `cd x && make deploy-y`, `bash -c "make deploy-y"`, `sudo make deploy-y` and `echo $(make deploy-y)` match. Text that is data does not: `echo "make deploy-x"`, a commit message.
- **Checked and reported.** A bad pattern, a rule other than `V-W-02` or `V-W-03`, or a branch name with other characters fails the config. `vulcan sync` writes both lists to the manifest, and `vulcan doctor` prints one note per entry.
- **Clearer rule text.** The `V-W-02` and `V-W-03` rows now say the hook asks on the commands it knows plus the project's `guard.writes.commands`; `vulcan sync` reports these base rules as changed once.

## Who is affected

- **Every project.** The new rule wording arrives on the next `vulcan sync`. Nothing else changes unless you list something.
- **A project with its own deploy, migrate or release commands.** List them ([the hooks reference](/references/hooks/#your-own-commands) has the example), run `vulcan sync` and commit the manifest.
- **A project that only uses Claude Code** can add a second layer through Claude Code's own permission rules in the same config (`claude.settings.permissions.ask`). Spell the migrate pattern `Bash(bun run migrate*)`: `Bash(bun run migrate:*)` does not match `bun run migrate:up`.

This is a guard against drift, not a sandbox: a command that builds its name at run time is not seen, and the guards ask rather than deny.
