# The delegation brief

A subagent knows only what the brief says. This is the template, and the rules around it. Rule `V-P-12`
puts mechanical work (sweeps, greps, renames, gates, counting) with a smaller-model subagent and keeps
judgment with the main agent, which re-checks what comes back.

**Contents**: [The brief](#the-brief) · [What comes back](#what-comes-back) · [Liveness](#liveness) · [Verifier and reviewer briefs](#verifier-and-reviewer-briefs) · [Parallel work](#parallel-work) · [Multi-session work](#multi-session-work) · [Starting another session](#starting-another-session)

## The brief

A brief is built only from files you read this turn, never from memory. It holds:

1. **The goal**, in one paragraph, and the claim or claims this piece of work serves.
2. **Pointers**, not pasted text: a work item first (`node_modules/@venizia/vulcan/base/references/work-item.md`; a tracker reference or its file), then the card, the notes and the files to read. When the work has an item the brief never restates it: the item holds the goal, the criteria and what is out of scope, and the brief adds only the rules, the limits and the format to return.
3. **The skill**, when the work matches one (`research`, `review-a-change`, `fix-a-bug`, `plan-a-change` and the rest): name it and tell the receiver to load it before it starts. Never retype its steps: a copy written by hand goes stale, the receiver may follow it instead of the skill, and the skill is the one source of how that work is done. A message to another session is a brief too: it names the skill the same way.
4. **The rules**: the digest reaches the subagent through the tool's subagent-start hook where one
   exists; otherwise name the rule IDs it must keep.
5. **Limits**: read-only unless the brief says otherwise; **no git writes**; every file it creates goes
   under `.agents/local/` (V-B-08); no network beyond what the task needs.
6. **What to return**: one of four statuses and the evidence (below), in a stated shape, under 400 words.
7. **A completion checklist** the subagent ticks, and a size bound, so one silent failure loses little.

Do not paste a summary of what you found into a brief: pass the path. A summary is a secondary source,
and a subagent that trusts it inherits your mistakes.

## What comes back

Each report ends with one status:

| Status             | Means                                             |
| ------------------ | ------------------------------------------------- |
| done               | The work is complete and the evidence is attached |
| done with concerns | Complete, with doubts named                       |
| needs context      | Stopped for a fact only the main agent has        |
| blocked            | Cannot continue; the reason is named              |

Treat the report as unverified claims about the files. Check the result on disk, or by running the
command, before a claim closes on it. A brief that asks for a count asks for the command that produced it.

## Liveness

A subagent that goes silent gets one nudge. If it stays silent it is reported as failed, and no claim
closes on its absence. A fix loop is capped at two rounds; then the owner decides.

## Verifier and reviewer briefs

List the steps to take and the evidence to return. Never write the answer you expect to find: a verifier
told what a pass looks like rationalises toward it. A reviewer's brief also asks for the list of what it
set aside and did not judge (see `review-a-change`).

## Parallel work

Read-only subagents may run in parallel in one checkout. Parallel agents that **write** collide at merge
time: give each parallel slice its own worktree under `.agents/local/worktrees/`, or run the slices one
after another. Making a worktree and merging are git writes: they happen on the owner's word (V-W-01),
and a merge into the integration branch is a class B action (V-W-06). A slice that merges the
integration tip first leaves the last merge a fast-forward. Subagents get pointers to files, not each
other's summaries.

## Multi-session work

Keep a small ledger next to the card: slice, state, evidence stub. A fresh context resumes from the
ledger and the card, never from the conversation. Size each unit of work to about one fresh context; a
unit that does not fit is split before it starts.

## Starting another session

A subagent started through the tool's own subagent mechanism is already exempt from the owner's report
shape: it gets the subagent card, not the owner shape or the profile. A session you start another way (a
new terminal, `claude -p`, a script, a session another agent works in) is not: its hooks hold its replies to
the owner's shape, log them as faults and, under `enforce: block`, send them back, although its reader is
you.

Start it with `VULCAN_OWNER_REPLY=off` on the command that starts it (`VULCAN_OWNER_REPLY=off claude -p ...`), never with `export`, which reaches every later session started from that shell. Only the exact value `off` counts. The
session then gets no owner shape card and no profile card, and its replies are not checked, logged or
blocked; everything else (the guards, the rules, the signals) stays on. A session started for one piece of
work is handed the item and the format ("take item X, return as Y"), not a long message. Say in the brief which plain
format you want back (the four statuses and the evidence table above are the default), in the language
you work in. Never set it in a shell the owner works in, or in the `env` of a settings file: `vulcan doctor` prints a
note when it is set in the shell that runs it and a warning when a Claude Code settings file sets it.
