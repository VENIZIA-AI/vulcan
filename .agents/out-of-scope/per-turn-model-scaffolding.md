# Per-turn model scaffolding

Decided: 2026-10-25, the owner, approving the agent-work design.

**Why not.** Calling a model on every turn to enforce process adds cost and latency to every task, and most violations are mechanical: a check catches them without a model.

**Reconsider if.** A violation class that no deterministic check can detect, measured over many sessions.
