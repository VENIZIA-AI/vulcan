# The dependency catalog gate and the release dispatch.

.PHONY: catalog-check release-plan release

# Every catalogued dependency is referenced as "catalog:" (root workspaces.catalog), none unused. The check is
# dev-configs's (`devz check catalog`): the root manifest beside packages/*, the wiki pinned to the catalog's versions.
catalog-check:
	@bun x --no-install devz check catalog --glob package.json --pinned docs/wiki/package.json

# One dispatch of .github/workflows/package-release.yml releases okf, atlas and cli as one train.
release-plan:
	@bun scripts/release/release.ts --dry-run $(ARGS)

release:
	@bun scripts/release/release.ts $(ARGS)
