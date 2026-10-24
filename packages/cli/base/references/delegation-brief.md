# The delegation brief

A subagent knows only what the brief says. This is the template, and the rules around it. Rule `V-P-12`
puts mechanical work (sweeps, greps, renames, gates, counting) with a smaller-model subagent and keeps
judgment with the main agent, which re-checks what comes back.

**Contents**: [The brief](#the-brief) · [What comes back](#what-comes-back) · [Liveness](#liveness) · [Verifier and reviewer briefs](#verifier-and-reviewer-briefs) · [Parallel work](#parallel-work) · [Multi-session work](#multi-session-work)

## The brief

A brief is built only from files you read this turn, never from memory. It holds:

1. **The goal**, in one paragraph, and the claim or claims this piece of work serves.
2. **Pointers**, not pasted text: the paths of the card, the notes and the files to read.
3. **The rules**: the digest reaches the subagent through the tool's subagent-start hook where one
   exists; otherwise name the rule IDs it must keep.
4. **Limits**: read-only unless the brief says otherwise; **no git writes**; every file it creates goes
   under `.agents/local/` (V-B-08); no network beyond what the task needs.
5. **What to return**: one of four statuses and the evidence (below), in a stated shape, under 400 words.
6. **A completion checklist** the subagent ticks, and a size bound, so one silent failure loses little.

Do not paste a summary of what you found into a brief: pass the path. A summary is a secondary source,
and a subagent that trusts it inherits your mistakes.

## What comes back

Each report ends with one status:

| Status | Means |
|---|---|
| done | The work is complete and the evidence is attached |
| done with concerns | Complete, with doubts named |
| needs context | Stopped for a fact only the main agent has |
| blocked | Cannot continue; the reason is named |

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

Parallel agents in one checkout are not allowed: they collide at merge time. Use a worktree under
`.agents/local/worktrees/` for each parallel slice, or run the slices one after another. Each slice
merges the integration tip first so the last merge is a fast-forward. Subagents get pointers to files,
not each other's summaries.

## Multi-session work

Keep a small ledger next to the card: slice, state, evidence stub. A fresh context resumes from the
ledger and the card, never from the conversation. Size each unit of work to about one fresh context; a
unit that does not fit is split before it starts.
