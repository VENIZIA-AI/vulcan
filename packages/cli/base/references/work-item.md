# The work item

A work item is a unit of work written so that two readers can use it: a person on the team learns what changes and why, and a fresh agent, holding only the item and the project's knowledge bundle (through atlas), can do the work. It is tracker-neutral: an issue, a ticket, or a file in the specs folder. This reference names no tracker.

An item is one slice of a card (see `plan-a-change`). The card holds the goal, the anti-claims and the decisions; an item holds only what its slice needs.

## The template

One fixed structure, the same in every project: a title line, then these nine headings, spelled exactly as written and in this order. The body under each heading is written in the language of the team that reads the item: the project's `owner.language`, English when it is unset. The fixed headings make an item searchable in any tracker and checkable by heading.

| Heading | Holds |
|---|---|
| Category | bug, enhancement or chore |
| Summary | The outcome, in one or two sentences |
| Current behaviour | What happens now; for an enhancement, the status quo it builds on |
| Desired behaviour | What happens when the item is done, with the edge cases and the error cases |
| Key interfaces | The names a reader looks for or changes: types, functions, routes, commands, permission codes, config keys. Never a path, never a line |
| Acceptance criteria | A checklist. Each criterion is one observable behaviour (WHEN ... THEN ...) with the probe that shows it: `test`, `property`, `cli`, `http`, `browser`, `eval`, `gate`, `read` or `manual` (see `node_modules/@venizia/vulcan/base/references/evidence.md`). They are the card's claims for this slice, with the same ids |
| Out of scope | What must not be changed, including the neighbour that looks related |
| Blocked by | The items that must finish first, or "none". Only what truly gates this one |
| Parent | The card or item this slice belongs to, or "none" |

The title is one line: what changes, for whom. Whether the item is ready for an agent or needs a human (and the decision that is open) is the tracker's own state or label; the strings belong to the project's tracker.

A small item:

```text
Retry a request on a network error

## Category
enhancement

## Summary
The HTTP client helper retries a request that failed on the network.

## Current behaviour
A network error is returned to the caller on the first failure.

## Desired behaviour
The helper retries up to the configured count. A response with an error status is never retried. The last error is returned when the retries run out.

## Key interfaces
- The helper's options type gains `retries`; the error type it returns is unchanged.

## Acceptance criteria
- [ ] C1 WHEN the first call fails on the network and the second succeeds THEN the caller gets the response (test)
- [ ] C2 WHEN the server answers 500 THEN there is exactly one call (test)
- [ ] C3 WHEN every call fails THEN the caller gets the last error (test)

## Out of scope
- Backoff; retrying uploads.

## Blocked by
none

## Parent
The HTTP client card.
```

## Writing rules

- **Durable.** Name types, functions, routes, commands, permission codes. Write no file path, no line number and no snippet of today's code: the item may wait for weeks while the code moves. A snippet that encodes a decision better than prose (a type shape, a state machine) is the one exception, trimmed to the decision.
- **Behavioural, not procedural.** Say what the system does, not which file to open or which branch to add. The agent explores the code fresh.
- **Testable.** Every criterion has a probe and can be checked on its own. "Works correctly" is not a criterion.
- **Readable by the team.** No agent or session names, no local path of one machine, no shorthand of one conversation. The first lines answer what and why.
- **One slice, one fresh context.** One behaviour at one agreed seam. A criterion that joins two checkable things with "and" is two criteria.
- **The project's words.** Use the vocabulary of the knowledge bundle; where the item needs a word the bundle lacks, that is a gap to fix in the bundle, not a paragraph to put in the item.
- **The no-op test.** Delete a sentence; if a fresh agent would act the same, the sentence was a no-op (`node_modules/@venizia/vulcan/base/skills/docs-writing/references/agent-documents.md`).

## The self-check

An item is ready for an agent when each line holds. Run it before the item is marked ready.

- [ ] A title line, then the nine headings of the template, spelled as written and in order.
- [ ] No local path, no line number, no agent or session name.
- [ ] Current behaviour and Desired behaviour are both stated, and the edge cases are in Desired behaviour.
- [ ] Every criterion is one behaviour with a probe, and the criteria together show the desired behaviour.
- [ ] Out of scope has content, and Blocked by and Parent are filled or say "none".
- [ ] Key interfaces name what to change by name; a reader can find each in the knowledge bundle or by atlas `symbol`.
- [ ] The body is in the project's `owner.language`.
- [ ] A person who was not in the conversation can say what changes and why from the first lines, and a fresh agent could start without asking.

An item that fails a line is not ready for an agent; if the missing part is a decision, the item needs a human and the decision is named.

## Where an item lives

With a tracker, publish the item through the project's own tooling, and use its native links for Blocked by and Parent where it has them. Without one, write one file per item under the specs folder next to the card, numbered in dependency order. Either way the item is kept current as work proceeds: ticks with evidence stubs, what is open, what is not verified. It is the handoff, so the next agent starts from the item and the bundle, not from a conversation or a long message.
