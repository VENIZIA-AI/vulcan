# Phase boundaries

At the end of a unit of work, and whenever the context is long, pick the next move by asking these
questions in order. The first yes wins, because every move except continuing turns a primary source into a
secondary one.

| # | Question | If yes |
|---|---|---|
| 1 | Does the next work need what is in this conversation, and is the context still sharp? | **Continue** |
| 2 | Is the unit done, with nothing the next one needs from this conversation? | **Clear** the context and start from the card |
| 3 | Does the next unit need a fresh window but not this conversation? | **Hand off**: update the work item where the project has one, else write a pointer file (see the `report-back` skill), and start there; a session you start yourself gets `VULCAN_OWNER_REPLY=off` (see the delegation brief) |
| 4 | Is the next piece isolated, with a clear input and a clear output? | **Subagent**, with a brief (`node_modules/@venizia/vulcan/base/references/delegation-brief.md`) |
| 5 | None of the above, and the context must shrink? | **Compact**, last, because it keeps a summary of a summary |

Sizing: a unit of work fits one fresh context, roughly the part of a window a model uses well, not the
whole of it. Prefer closing a coherent unit and re-entering from the card over pushing one long session
through compaction. The artifact (the card, the ledger, the commits) carries the state; the conversation
does not.

Save before you move: the card and the ledger say what is done, what is open, and what is not verified.
