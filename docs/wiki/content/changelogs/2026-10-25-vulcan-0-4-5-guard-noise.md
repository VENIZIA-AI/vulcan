---
title: "VULCAN 0.4.5: The Write and Remote-Host Guards Stop Asking About Data"
description: A heredoc written to a file and the quoted pattern of rg, grep and similar tools are data, not commands; the write guard and the remote-host guard now read the command through the shared parser, so 12 of 16 noisy shapes no longer ask and the 24 real ones still do.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.5: the write and remote-host guards stop asking about data

<Badge type="warning" text="Behavior Change" />

**In one line.** `cat > docs/deploy.md <<EOF ... kubectl apply ... EOF` and `rg -n "kubectl apply|docker compose up" docs/` no longer ask: a heredoc written to a file and the arguments of a search are data. A heredoc that feeds a program that runs it (`bash <<EOF`, `ssh host <<EOF`, `psql <<EOF`) still asks, and so does everything that really runs.

**What to do.** Update `@venizia/vulcan`; nothing else. The hooks load from `node_modules`.

**Who is affected.** Every project that syncs VULCAN: fewer asks from `guard-writes` (V-W-02, V-W-03) and `guard-remote-hosts`. Nobody has to do anything; `vulcan sync` is not needed, the hooks read the package.

## Why

BANA scanned 228 transcripts over 3 days (13,000 Bash calls): the base hooks raised 142 asks (remote host 58, outside the project about 50, migration 20, endpoint 8, deploy 2, database 1). Most of the remote-host and migration asks were false positives: the guards matched the text of the whole line, so a doc that mentions `kubectl apply` inside `cat > f <<EOF` and the quoted pattern of an `rg` fired. A guard that cries wolf trains people to click yes, which defeats it.

## What changed

- **`guard-writes` and `guard-remote-hosts` read the command through the shared parser** (the one `guard-git` uses), not the raw text. The patterns run on what each simple command runs.
- **A heredoc body that is only data is not a command:** the body of `cat > f <<EOF`, `tee f <<EOF` and the like is taken out. A body that a shell reads (`bash <<EOF`) is read as commands, which also lets `guard-git` see a `git push -f` inside it; a body that another program runs (`ssh`, `psql`, `mysql`, `mongosh`, `sqlite3`, `python`, `node`, `bun`, `deno`, `ruby`, `perl`, `php`) is part of that command.
- **The arguments of read-only tools are data:** `rg`, `grep`, `egrep`, `fgrep`, `ag`, `ack`, `cat`, `less`, `more`, `head`, `tail`, `wc`, `ls`, `diff`, `sort`, `uniq`, `echo`, `printf`, `man`, `file`, `stat`, `which`, and `find` without `-exec`, `-execdir`, `-ok`, `-okdir` or `-delete`. For the write guard `git` and `gh` are data too (a commit message, an issue body); the remote-host guard still reads a git remote as a host.
- **A print or a search piped into a program that runs its input still asks:** `echo "kubectl apply -f x" | sh` is code.
- **The parser:** a heredoc operator is no longer read as a word (`cat <<EOF` was `["cat", "EOF"]`, it is `["cat"]`), and the body is carried on the command that reads it.
- **`/tmp` still asks, on purpose:** the project rule is that agent files stay in the project, and allowing `TMPDIR` would break it. The ask now names the place: `.agents/local/tmp/<task>/` (worktrees under `.agents/local/worktrees/`, clones under `.agents/local/clones/`).

## What it did on the same shapes

A corpus of 16 shapes that must stay quiet (heredoc docs, quoted `rg`, `grep`, `git grep`, a commit message, `echo`, `gh issue`) and 24 that must ask (a deploy, `bash <<EOF`, `ssh host <<EOF`, `psql <<EOF`, a mutating `curl`, `find -exec`, `sh -c`, a pipe into `sh`, an unlisted host, a SQL write, a migration), run through `guard-writes` and `guard-remote-hosts`:

| | Before | After |
|---|---|---|
| Quiet shapes that asked | 12 of 16 | 0 of 16 |
| Real shapes that asked | 24 of 24 | 24 of 24 |

The corpus is `noise-corpus.ts` in the tests, built from the shapes BANA described, not from its transcripts.

## What to know

- A guard reads a static line: a script file that holds the deploy, a variable and a command built at run time stay out of reach, as the hooks page says.
- `echo`, `printf` and the other print tools are data to the guards even when their output is redirected into a file; a heredoc or a pipe into a runner is the case they still check.
