# Auto-commit per claim

Decided: 2026-10-25, design review.

**Why not.** Committing on its own as each claim closes needs `--no-verify` and writes git without the user's word, which V-W-01 forbids. Slice boundaries are proposed commit points in the work card instead.

**Reconsider if.** The git authority model changes so that an agent may commit unasked.
