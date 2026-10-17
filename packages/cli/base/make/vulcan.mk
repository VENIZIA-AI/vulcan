# Shipped by @venizia/vulcan - include it, never copy it:
#   -include node_modules/@venizia/vulcan/base/make/vulcan.mk
# A project adds its own targets after the include; redefining one of these fails `vulcan doctor`.

VULCAN ?= bun x --no-install vulcan

.PHONY: vulcan-sync vulcan-doctor agent-setup okf-check okf-check-strict okf-gen okf-coverage okf-viz \
        surface-gen surface-check atlas-symbols atlas-releases changelogs-migrate \
        knowledge-symbols-check

vulcan-sync: ## Write the agent adapters, settings, skill links and manifest from the config
	@$(VULCAN) sync

vulcan-doctor: ## Check the project against the VULCAN contract
	@$(VULCAN) doctor

# The older name for the same job, kept for muscle memory.
agent-setup: vulcan-sync ## The older name for vulcan-sync

# OKF v0.2 conformance only; okf-check-strict adds the house rules (links, style, coverage, freshness).
okf-check: ## Check the knowledge bundle against OKF v0.2
	@$(VULCAN) x okf check

okf-check-strict: ## okf-check plus the house rules: links, style, coverage, freshness
	@$(VULCAN) x okf check --strict

okf-gen: ## Regenerate the generated pages and regions of the knowledge bundle
	@$(VULCAN) x okf gen

okf-coverage: ## Report how much of the code the knowledge bundle covers
	@$(VULCAN) x okf coverage

okf-viz: ## Build the knowledge graph view
	@$(VULCAN) x okf viz

# The public surface: an optional API gate a project commits and checks. It reads the built .d.ts -
# build first.
surface-gen: ## Write the public API surface from the built .d.ts
	@$(VULCAN) x atlas surface gen

surface-check: ## Fail when the public API surface differs from the committed one
	@$(VULCAN) x atlas surface check

# Symbols are read from the built or installed .d.ts when atlas is asked - nothing to commit.
# atlas-symbols prints what atlas reads, to see what symbol answers from. Build first.
atlas-symbols: ## Print the symbols atlas reads from the built or installed .d.ts
	@$(VULCAN) x atlas symbols

# Releases are computed from tags when atlas reads the project - nothing to generate or commit.
# atlas-releases prints the computed table, to see what version and changes answer from.
atlas-releases: ## Print the release table atlas computes from the tags
	@$(VULCAN) x atlas releases

# Writes the packages: list into every changelog entry that declares none - once, then review it.
changelogs-migrate: ## Write the packages: list into changelog entries that declare none
	@$(VULCAN) x atlas changelogs migrate

# A concept may name code (`symbols:` in its frontmatter); this fails when a named symbol is gone or its
# signature changed since `vulcan x atlas concepts stamp`. It reads the built .d.ts - run it after build.
knowledge-symbols-check: ## Fail when a symbol a concept names is gone or its signature changed
	@$(VULCAN) x atlas concepts check
