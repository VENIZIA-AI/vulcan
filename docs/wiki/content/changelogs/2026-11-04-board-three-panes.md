---
title: The board is three panes, and the flow diagram, the columns and the attempt rounds are gone
description: The board page shows agents, work items and the detail side by side; a card tells where a flow is, what is happening now and how far it got. The diagram, the Board columns view and the stage attempt rounds are removed.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-04

## The board is three panes, and the flow diagram, the columns and the attempt rounds are gone

<Badge type="warning" text="Breaking Change" />

**In one line.** `vulcan board` now draws agents, work items and the detail of the one you picked side by side, so you see who is doing what and how far each flow is without opening anything.

## What changed

- **Agents, left.** One card per agent: its state, the flow it works on, its newest action and message, its open pull requests, and its role, model and harness when they are known (see [flow lists](/changelogs/2026-11-04-flow-lists-deploy-model-role)). Picking an agent narrows the work items to its flows and opens its detail; pick it again to undo both.
- **Work items, middle.** The flows grouped by state. A card says where the flow is, what is happening now (the first sentence of the next step, else the reason), how far its steps are, who is on it, its pull requests, its due day (red when it is two days away or sooner, or past) and what it waits for.
- **Detail, right.** Opens when you pick a flow or an agent; closes with the cross or `Esc`. A flow shows what it is, its steps and acceptance checks, what it waits for, its milestones (opened, decided, merged, deployed) and **All events**. On a phone the detail opens over the list.
- **Removed.** The flow diagram, the **Board** view with columns, and the buttons for the attempt rounds of a stage. The CI and review counts are no longer drawn; the event log and the board data are unchanged.
- **No agent is hidden.** Every agent that wrote a line or has a session has a card. `board.agents` no longer filters: the listed names come first, and a `lane` is a label ("under api") on the helper's own card, not a merge of its lines into the lane's. The "+N helpers" count and the roster filter are gone.
- **A Details button on the Agents pane.** Off, each agent is one row (name, state and time, the flow it works on, a red dot when it asks you); on, today's full card. The choice is kept in the browser. Agents not heard from in 24 hours are folded under **Earlier (n)**.
- **Flat panes.** The panes are rows with one hairline between them, not cards inside a bordered pane; the selected row has the accent bar.
- **Unanswered means something.** On an agent's card it counts the messages sent to it after the last one it sent, each once, not every message it ever got.
- **Working or idle follows the latest line.** An agent that writes a line of work after a session stop is working again, since that line; it no longer stays "idle since the stop". After 30 minutes with no line it is idle again.
- **Done includes a deploy, and lasts a week.** A `deploy` line closes its flow like a merge does, until later work reopens it. The Done group keeps the last seven days (it kept only today).
- **Lines with no flow are not a work item.** They are one muted line under the groups, `Unsorted · n`, that opens a list.
- **No "no title yet" marker.** A flow without a `flow` line shows the words of its first line as its title, and nothing says it has none.
- **Smaller page.** The page is about the same size with more on it; it still has no network call and runs no script from the data.

## Who is affected

- **Anyone who set a roster or lanes in `board.agents`:** the agents they hid are now shown. Keep the list for the order and the `lane` for the label.
- **Anyone who used the diagram or the columns view:** they are gone; the work items pane groups the same flows by state.
- **Everyone else:** nothing to do. Run `vulcan board` again to get the new page.
