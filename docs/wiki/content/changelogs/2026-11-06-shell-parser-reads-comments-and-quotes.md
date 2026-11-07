---
title: The shell parser reads comments, arithmetic and multi-line quotes
description: The shell parser the guards share reads comments, arithmetic and multi-line quotes the way bash does, and asks when it cannot tell.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-06

## The shell parser reads comments, arithmetic and multi-line quotes

<Badge type="warning" text="Security" />

**In one line.** The shell parser the guards share reads comments, arithmetic and multi-line quotes the way bash does, and asks when it cannot tell. Update `@venizia/vulcan`.

## What changed

- **One pass, like bash.** The parser reads a command line once, left to right, and keeps its quote state across lines: single quotes, double quotes, `$'...'`, backticks, `$(...)`, `${...}` and escapes.
- **Comments.** A `#` at the start of a word, outside quotes, starts a comment that ends at the newline. `$#`, `${#x}`, `a#b`, `a\ #b` and a `#` right after an expansion (`$((1))#x`) are not comments. Nothing in a comment starts a heredoc.
- **Arithmetic.** A `<<` in `$((...))`, `((...))` or `$[...]` is a shift, not a heredoc. A `$(...)` inside arithmetic is still read as commands.
- **Heredocs.** A `<<` inside a quoted string that spans lines is text. A body starts at the next newline and ends at its delimiter line. The delimiter may be quoted or escaped and may be any word. Several heredocs on one line read their bodies in order, each paired with its own command. A heredoc inside `$(...)` stays with the command that reads it. A body ends only at the line that is exactly its delimiter (`<<-` strips leading tabs first), and in a body whose delimiter is not quoted a backslash-newline joins two lines.
- **Substitutions in a body.** A body whose delimiter is not quoted runs its `$(...)` and backtick substitutions, so the guards read those as commands. A quoted delimiter (`<<'EOF'`) keeps the whole body as data.
- **A body that never ends.** It is data up to the end of the line, as bash reads it, and the line asks. `guard-git` also reads its lines as commands and asks about anything it would deny or ask.
- **Substitutions and keywords.** The `)` of a `case` pattern inside `$(...)`, `<(...)` or backticks does not close the substitution. An escaped backtick inside backticks is a substitution of its own. `>(...)` is read like `<(...)`. `coproc`, `function` and `builtin` are read past to the command they run, and the code `trap` sets is read as commands. A descriptor number before a redirection (`0<<EOF`) is not a word.
- **A program the line does not name.** A command whose program is a variable or a substitution (`$cmd`, `"$@"`, `$(tool) push`, `eval "$(tool env)"`) asks in `guard-git`, `guard-outside`, `guard-writes` and `guard-remote-hosts`. A variable in an argument does not. A variable anywhere in the program word counts (`$k/deploy.yaml`), `$HOME/` included, because the same line can set it.
- **What it cannot tell asks.** These make a line uncertain:
  - a quote, `$(...)`, `${...}` or arithmetic that never closes;
  - a `<<` with no delimiter word;
  - a `((` that bash reads again as subshells;
  - nesting past 64 levels.

  `guard-git`, `guard-outside`, `guard-writes` and `guard-remote-hosts` ask about an uncertain line, as they do about a line over the budget.
- **Ordinary lines.** An ordinary line reads as before, with three exceptions besides the ones above. A comment no longer appears as a command. `$((1<<2))` no longer adds a stray command. Both bodies of `cat <<A <<B` are now data. The parser stays linear in the length of the line, within the 100,000-character budget.

## Who is affected

- **Every project that installs the VULCAN hooks:** update `@venizia/vulcan`. A command on the line after a comment, an arithmetic shift or a multi-line string is now checked like any other. A line with a quote that never closes, or whose program is a variable, asks once.
