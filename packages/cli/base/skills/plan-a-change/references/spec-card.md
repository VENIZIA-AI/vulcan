# The spec card

The card is the agreement between the owner and the agent. It is small text, and a section that is empty
is left out. Lane S uses three lines. Lane M uses Goal, Out of scope, Claims (each with its probe) and Docs impact, in chat or the pull request description. Lane L uses all of them, in a file.

**Contents**: [Sections](#sections) · [Rules of the card](#rules-of-the-card) · [Probes](#probes)

## Sections

In this order:

| Section | Content |
|---|---|
| Goal | The owner's words, verbatim. It changes only through a dated Decisions line |
| Out of scope | What is not built, in prose |
| Runs by | Each outward action the plan needs and who runs it: a release dispatch, creating or deleting a repository, closing an issue, a push to a shared ref, writing a setting. Name the agent, or the owner where the session's permission check may refuse the action; the plan then stops there and hands it over instead of finding out mid-run. Left out when the plan has none |
| Claims | `C1..Cn`: one observable behaviour each, and for each the probe that would show it false. Behaviour is phrased WHEN ... THEN ... |
| Anti-claims | What must not happen, in the universal form where you can ("no X in any path"). Lane L has at least one |
| Seams | The public boundaries tests attach to. An existing seam is preferred; the ideal count is one |
| Docs impact | The pages, knowledge concepts and changelog entry that change, or `none` with the reason |
| Open | Questions too dim to be claims, each naming who resolves it. Empty before work starts |
| Decisions | Dated, append-only. Dead ends and rejected alternatives stay. A `refined:` prefix marks a change of goal or claim |

## Rules of the card

- IDs never renumber. A split claim becomes `C3.1`, `C3.2`; a dropped claim leaves a tombstone.
- A claim with no nameable probe goes to Open.
- If you can edit the Goal without changing any claim, the claims are not tied to it.
- Split a claim while it joins two checkable things with "and" or "or", while one part can pass as another
  fails, or while it says "all" or "every" without listing.
- In lane L each slice is written as a work item (`node_modules/@venizia/vulcan/base/references/work-item.md`): its acceptance criteria are the claims of that slice, with the same ids and probes.
- The card carries no changelog: git is the change record. When a claim closes, its evidence shrinks to a
  one-line stub (the commit, the test name or the command).
- Fog goes to Open, never into a claim. Docs impact unknown is itself an Open question.

## Probes

The probe is on the claim's line, one of a closed list (`test`, `property`, `cli`, `http`, `browser`,
`eval`, `gate`, `read`, `manual`). What each means, and the evidence each kind of claim needs, are in
`node_modules/@venizia/vulcan/base/references/evidence.md`. An unavailable verifier is reported as
deferred-verify, never as passed.
