# The design pass

A design pass is a section of the card, not a separate document. It runs for lane L and for any of: a new
public API, a cross-package change, auth or security, a data model, a new dependency, a new abstraction.

**Contents**: [What to write](#what-to-write) · [Design it twice](#design-it-twice) · [What becomes knowledge](#what-becomes-knowledge)

## What to write

Write a decision only where two implementers could choose differently and both choices would compile. For
each decision:

- the choice, in one sentence;
- the alternative rejected, and why;
- for a new dependency or a new abstraction: "simpler alternative rejected because ...".

List what is deferred, each with its reason. A deferred item without a reason is an open question: move it
to Open.

## Design it twice

For a new interface, ask three or more read-only subagents for radically different designs, each briefed
with the goal, the seams and the constraints, and nothing about the others. Compare them on three things:

- **Depth**: the fewest methods and parameters that cover the behaviour, with the complexity behind them.
- **Locality**: a change in one place stays in one place.
- **Seam placement**: where a test can observe the behaviour.

Keep the deeper design. Record the rejected ones in Decisions.

Test a module by deleting it in your head: if the complexity reappears across its callers, the module
earned its place; if it vanishes, it was a pass-through. One adapter means a hypothetical seam; two
adapters mean a real one.

## What becomes knowledge

A decision is promoted to a concept in the knowledge bundle only when all three hold: it is hard to
reverse, it would surprise a reader without context, and it is a real trade-off. If one is missing, it
stays in the card.
