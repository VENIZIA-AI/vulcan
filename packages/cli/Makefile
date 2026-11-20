# Bun runs the source directly: `plain` makes `build` a type-check, no emit (`bun check`).
FORMATS := plain

# The hooks, built into base/bundle: what `vulcan sync` copies into a project's .agents/local/hooks and the package ships.
POST_BUILD := bun ../../scripts/hooks-bundle/build.ts

include ../../make/project.mk
