---
title: vulcan profile
description: Tell VULCAN how you like to work - reply language, how to address you, tone, habits - in a file inside the project that only you have.
---

# vulcan profile

`vulcan profile` asks a short set of questions and saves the answers in `.agents/local/profile.json`: inside the project, gitignored, mode 0600. The session digest turns them into a short card, so an agent addresses you the way you asked. Every question has a default and can be skipped. Nothing is read from or written outside the project, and nothing is inferred from your answers.

| Command | What it does |
|---|---|
| `vulcan profile` or `vulcan profile edit` | Asks the questions, with your earlier answers as the defaults, and saves the file |
| `vulcan profile show` | Prints the file, or says there is none yet |
| `vulcan profile reset [--yes]` | Says what it would delete; with `--yes` deletes `.agents/local/profile.json` and nothing else |

`vulcan init` offers the form once, in a terminal, when the project has no profile. Without a terminal it only prints the command to run.

## The questions

| # | Question | Default |
|---|---|---|
| 1 | Reply language, as a code such as `en` or `pt-BR` | the language of the machine (`LANG`), else English |
| 2 | How to address you: a name, a pronoun, an honorific, or nothing | nothing |
| 3 | How the agent refers to itself | neutral |
| 4 | How formal: `informal`, `neutral` or `formal` | `neutral` |
| 5 | Tone: `terse`, `neutral` or `friendly` | `neutral` |
| 6 | Reports: `headline` only, or `tables` too | `tables` |
| 7 | Ask before a choice that can be undone, or state a default and continue | state a default and continue |
| 8 | Propose commits when a piece of work is done | no |
| 9 | Anything about how you like to work, in your own words | none |
| 10 | Taste in code that no formatter or lint rule enforces | none |

Only English labels ship, and no label is a fixed word. If question 1 is a language other than English, the form asks whether to type the words for the report now (the three column headers, the six statuses and five labels, each defaulting to the English one) or let the agent write them in that language. Typed words are stored in the profile under that language and are held exactly. When you let the agent write them, the session digest tells it to write every label in your language and form of address, and the check looks at the structure only (see [labels follow the reader](/references/configuration/#labels-follow-the-reader)).

The form runs as menus in a terminal that can draw them and as plain lines otherwise: an empty line takes the default, a value that does not fit is asked again with the reason, and the end of the input cancels with nothing written.

## Where the file lives, and what stops a mistake

- It is saved only when `.gitignore` names `.agents/local/` (`git check-ignore` decides inside a repository); otherwise the command says to run `vulcan sync` first.
- A symlink at the file's place or at `.agents/local` is refused.
- `vulcan doctor` warns when the file cannot be read, when git would pick it up and when git tracks it.

The fields, and how a profile combines with the project's [`owner` block](/references/configuration/#owner), are in the [configuration reference](/references/configuration/#the-personal-profile).

## Exit codes

| Code | When |
|---|---|
| `0` | saved, shown, reset, or nothing to reset |
| `1` | cancelled, an unreadable profile, `.agents/local/` not gitignored, or an unknown argument |
