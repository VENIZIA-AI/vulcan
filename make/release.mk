# The dependency catalog gate and the release dispatch.

.PHONY: catalog-check release-plan release

# Every catalogued dependency is referenced as "catalog:" (root workspaces.catalog), none unused.
catalog-check:
	@bun scripts/checks/check-catalog.ts

# One dispatch of .github/workflows/package-release.yml releases okf, atlas and cli as one train.
release-plan:
	@bun scripts/release/release.ts --dry-run $(ARGS)

release:
	@bun scripts/release/release.ts $(ARGS)
