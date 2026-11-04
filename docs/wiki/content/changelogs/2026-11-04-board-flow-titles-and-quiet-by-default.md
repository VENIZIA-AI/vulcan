---
title: The board names each flow, and leaves agent plumbing out until you ask for it
description: A new flow event gives a flow a title and a reason, and the board hides session starts and stops, subagent stops and idle prompts unless you press Show all events.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-04

## The board names each flow, and leaves agent plumbing out until you ask for it

<Badge type="tip" text="New Feature" />
<Badge type="info" text="Behavior Change" />

**In one line.** An agent can now give a flow a title and a reason, and the board shows them as the flow's heading; the lines that only say an agent started, stopped or waited are hidden until you press **Show all events**.

## What changed

- **A `flow` event.** `vulcan event add --kind flow --flow F-12 --title "<title>" --why "<one line>"` names a flow, in any language. The newest `flow` line of a flow wins, title and reason together. `--why` is optional; `--title` and `--flow` are required, and a `flow` line takes no `--summary`.
- **The heading of a flow is its title.** The board shows the title and, in the detail pane, the reason under it. Messages and the other lines stay in the pane as detail. A flow with no `flow` line keeps the heading it had before and is marked "no title yet".
- **Agent plumbing is hidden by default.** Session starts and stops, subagent stops, and the idle or permission prompts of the harness are no longer lines of a flow, nor of the list, the diagram, the agent graph or the counts. **Show all events** puts them back. A `needs-owner` line with a real question stays visible.
- **An idle prompt no longer makes a flow wait for you.** It used to count as an ask. Only a question a person or an agent wrote does.
- **Context and next step.** A `flow` line also takes `--context` (what the flow is, what is done, what is left; up to 600 characters) and `--next` (the next step and who does it). The detail pane reads from the top: title, reason, Context, Next, then Latest, the three newest lines of work as one sentence each, then the stages. The newest `flow` line wins as a whole, so a new line repeats the fields that still hold.
- **A flow with only a `flow` line shows "No work logged yet"**, not a Proposal box with one event (and its row in the list shows a **No work yet** chip and its next step or reason, not a stage and its own title), and a line no longer prints the tag of the tool that wrote it (`cli`).
- **A rule for agents.** `V-P-13` asks an agent to log a `flow` line in the owner's language when it starts work on a flow, with its title, reason, context and next step, and a new one when the context changes materially; it applies only to a project that has `events.log` on.

## Who is affected

- **Everyone who reads a board:** flows that used to show a message label as their heading show it until an agent writes a `flow` line; flows that waited on you only because of an idle prompt now show as running.
- **Projects that write events by hand:** nothing breaks. A reader older than this version skips a `flow` line as an unknown kind, as it did with any new field.

Write the board again with `vulcan board` to see it.
