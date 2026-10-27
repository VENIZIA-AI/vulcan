# One command for what CI runs. The list is read from .github/workflows/ci.yml (scripts/checks/gates.ts), so it cannot drift from CI.
.PHONY: gates

gates:
	@bun scripts/checks/gates.ts $(ARGS)
