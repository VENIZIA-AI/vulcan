---
title: guard-manifest no longer refuses a command that only uses a variable next to an .agents path
description: A command that holds a variable and a plain path such as .agents/local/tmp/run.log, or a for loop over $(seq 1 40), was refused with "vulcan.manifest.json is generated" although it never touched the manifest.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-07

## guard-manifest no longer refuses a command that only uses a variable next to an `.agents` path

<Badge type="warning" text="Bug Fix" />

**In one line.** `guard-manifest` read every variable on a line as a possible path to the manifest as soon as the line held the letters "agents", so `F=scripts/agents/tool.ts; bun $F out.txt` and `for i in $(seq 1 40); do ...; done; tail .agents/local/tmp/run.log` were refused with "vulcan.manifest.json is generated". They pass now.

## What changed

- **A plain path below an `agents` folder, given as an argument or a redirect target, is not a mention of the manifest.** `.agents/local/tmp/run.log` and `scripts/agents/tool.ts` are neither the folder nor the file, so a variable elsewhere on the line is no longer read as the manifest. The folder itself (`cd .agents`, `ls .agents`), a glob or an expansion in the path (`.agents/*`, `.agents/$F`, `.agents/local/../$F`) and any piece of the file name still make the line about the manifest. So does such a path when it becomes part of another word: a value assigned to a variable that is then used as `$G/..`, a `for` word, an argument after `sh -c`, a path inside `$(...)`, one given to `cd` or `xargs`, one whose output is piped into anything but a reader or read back, or one with a link below its `agents` folder.
- **A `for NAME in WORDS` header only walks its list.** The list is no longer checked as the arguments of a command called `for`; the body is checked where it uses each word.
- **A `cd` into an `.agents` folder from outside it** makes the rest of the line about the folder, as naming it does.
- **Still refused:** `f=.agents/vulcan.manifest.json; cp x $f`, a name split across variables (`a=vulcan; b=.manifest.json; cp x .agents/$a$b`), `cp x $(printf '%s/%s' .agents vulcan.manifest.json)`, `cd .agents/local && sed -i s/2/9/ ../$F`.

## Who is affected

- **Every project that uses the shipped hooks:** fewer wrong refusals, most of all for scratch work under `.agents/local/`. `vulcan sync` is not needed; the hook ships inside the package.
