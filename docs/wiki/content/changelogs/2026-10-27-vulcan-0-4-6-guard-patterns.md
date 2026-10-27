---
title: "VULCAN X.Y.Z: A Project Lists the Deploy, Migrate and Push Targets Its Guards Ask About"
description: guard-writes and guard-git now ask about the commands and push targets a project lists in its config, found inside compound commands too, so the guards no longer promise more than a fixed list covers.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-27

## VULCAN X.Y.Z: a project lists the deploy, migrate and push targets its guards ask about

<Badge type="danger" text="Security" /> <Badge type="tip" text="Enhancement" />

**In one line.** `guard-writes` asks on the deploy and migrate commands a project lists, and `guard-git` asks for a plain `git push` to the branches it lists, so `make deploy-develop-x`, `bun run migrate:up` and `git push origin develop` are no longer invisible to the guards.

## What changed

- **The gap.** The guards knew a fixed list. `guard-writes` asked for `kubectl apply`, `docker compose up`, `db:migrate`, `drizzle-kit push` and a few more; `guard-git` refused a force-push or a delete of `develop` and `main` and asked about `--mirror`, but a plain `git push origin develop` passed. A project could not add anything (its only guard key listed scripts to trust), and the session digest and the rows of `V-W-02` and `V-W-03` said the hook asks, which promised more than the list covered. BANA's `bun run migrate:up` and `make deploy-develop-*` matched nothing.
- **`guard.writes.commands`.** A list of `{ rule, what, pattern }`: `rule` is `V-W-02` or `V-W-03`, `what` names the action, `pattern` is a JavaScript regular expression (`ignoreCase: true` for the other spelling). A command that matches asks, with the rule and `<what> (this project's pattern)`.
- **`guard.git.askPush`.** Branch names, with `*` for any run of characters. A plain `git push` to one of them asks, also from a bare `git push` on that branch and with `HEAD:release/1.2`. A force-push or a delete of `develop` or `main` is still denied, once.
- **Found inside compound commands.** `cd services/api && make deploy-develop-x`, `a; b`, `(cd x; make deploy-y)`, `if true; then make deploy-y; fi`, `bash -c "make deploy-y"`, `sudo make deploy-y` and `echo $(make deploy-y)`. Text that is data does not match: `echo "make deploy-x"`, `rg 'make deploy-' docs`, a commit message.
- **Validated, and read without the config.** A pattern that does not compile, a rule that is not `V-W-02` or `V-W-03`, or a branch name with other characters fails the config. `vulcan sync` writes both lists into the manifest as a `guard` block (only when set; a project that lists nothing has the manifest it had), and the hooks read it from there, with no config loader and no zod. An entry the hook cannot use is skipped and said once on stderr; the others stay.
- **The wording.** The rows of `V-W-02` and `V-W-03` now say the hook asks "on the commands it knows plus the project's `guard.writes.commands`". `vulcan sync` reports these base rules as changed once.
- **`vulcan doctor`** prints one note per listed command and one for the push targets.

## Who is affected

- **Every project.** The new rule wording reaches you on the next `vulcan sync`; nothing else changes unless you list something.
- **A project with deploy, migrate or release commands of its own.** List them: [the hooks reference](/references/hooks/#your-own-commands) has the example. Run `vulcan sync` and commit the manifest.
- **A project that only uses Claude Code** can add a second layer through Claude Code's own permission rules in the same config (`claude.settings.permissions.ask`). Spell the migrate pattern `Bash(bun run migrate*)`: `Bash(bun run migrate:*)` does not match `bun run migrate:up`.

## Details

- This is a guard against drift, not a sandbox: a command that builds its name at run time is not seen, and the guards ask rather than deny.
- Not checked: an interactive prompt for the Claude Code ask rules (the check used `claude -p`, where an ask is refused), and the other agents' own permission systems.
