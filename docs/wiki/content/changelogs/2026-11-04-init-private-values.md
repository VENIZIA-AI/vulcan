---
title: vulcan init ignores env files and your personal host list, and an agent gets a folder of its own
description: init puts every .env file and the personal remote-hosts file in .gitignore, writes an example of that file, and doctor knows .agents/local/agents/ as the home of one agent's own state.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-04

## `vulcan init` ignores env files and your personal host list, and an agent gets a folder of its own

<Badge type="tip" text="New Feature" />
<Badge type="info" text="Behavior Change" />

**In one line.** A fresh `vulcan init` keeps secrets and private host names out of git, and `vulcan doctor` knows `.agents/local/agents/<name>/`.

## What changed

- **Env files are ignored.** The `.gitignore` that `init` writes (and the lines it appends to an existing one) now carry `**/.env`, `**/.env.*` and `!**/.env.example`. Before, a new monorepo ignored only `.env`, so a `.env.local` or a `.env.production` could be committed. The generated `.dockerignore` carries the same three lines from one shared list, so the two files cannot drift.
- **Your own `.env` rules win.** If your `.gitignore` already has a `.env` rule (`.env*`, `!.env.development`, `!**/.env.example` ...), `init` does not append the three `.env` lines after it, because git uses the last matching line and they would undo your negations. It says so in `left to do:`. A `.gitignore` with no `.env` rule gets the three lines.
- **Your own hosts have a place.** `init` adds `.agents/hooks/trusted-hosts.local` to `.gitignore` and writes `.agents/hooks/trusted-hosts.local.example`, a file of comments to copy from, with no real host in it. Only the default path is added to `.gitignore`; if the config names another `remoteHosts.localFile`, ignore that path yourself. A host name that you do not want in the committed config goes in your copy, as a plain line (trusted) or as `readonly: <host>`. `init` also says so in its `left to do:` list.
- **One folder per agent.** `.agents/local/agents/<name>/` is the home of one agent's own state: notes, staged copies and scratch that outlives a session. `vulcan doctor` no longer flags it as an unknown entry, `vulcan clean` never takes it, and the [`.agents` folder](/guides/core-concepts/the-agents-folder) page lists it. A script the team relies on does not belong in `.agents/local/`: the unknown-entry warning now says to put it in the tracked tree (`scripts/`), where it gets review and history.

## Who is affected

- **Projects that run `vulcan init` again:** the new lines are appended to your `.gitignore` and the example is written; nothing you wrote is overwritten. A project that already committed a `.env.local` should remove it from git (`git rm --cached`) and rotate what it held.
- **Everyone else:** nothing changes.
