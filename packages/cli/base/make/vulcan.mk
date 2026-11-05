# Shipped by @venizia/vulcan - include it, never copy it:
#   -include node_modules/@venizia/vulcan/base/make/vulcan.mk
# A project adds its own targets after the include; redefining one of these fails `vulcan doctor`.

VULCAN ?= bun x --no-install vulcan
VULCAN_BASE ?= node_modules/@venizia/vulcan/base
# The GitHub repository the wiki links point into, owner/name; the link gate checks only links into it.
WIKI_REPO ?=

.PHONY: vulcan-sync vulcan-doctor okf-check okf-check-strict okf-gen okf-coverage \
        surface-gen surface-check atlas-symbols atlas-releases wiki-links-check wiki-anchors-check

vulcan-sync: ## Write the agent adapters, settings, skill links and manifest from the config
	@$(VULCAN) sync

vulcan-doctor: ## Check the project against the VULCAN contract
	@$(VULCAN) doctor

# OKF v0.2 conformance only; okf-check-strict adds the house rules (links, style, coverage, freshness).
okf-check: ## Check the knowledge bundle against OKF v0.2
	@$(VULCAN) x okf check

okf-check-strict: ## okf-check plus the house rules: links, style, coverage, freshness
	@$(VULCAN) x okf check --strict

okf-gen: ## Regenerate the generated pages and regions of the knowledge bundle
	@$(VULCAN) x okf gen

okf-coverage: ## Report how much of the code the knowledge bundle covers
	@$(VULCAN) x okf coverage


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

# The wiki link gates. Set WIKI_REPO (owner/name) in the project's Makefile before the include. Flags go in
# WIKI_LINKS_FLAGS (--dirs, --skip-prose, --skip) and WIKI_ANCHORS_FLAGS (--content, --dist).
wiki-links-check: ## Fail when the wiki or the knowledge bundle names a source path git does not track
	@bun $(VULCAN_BASE)/checks/wiki-source-links.ts --repo "$(WIKI_REPO)" $(WIKI_LINKS_FLAGS)

wiki-anchors-check: ## Fail when a wiki #fragment link has no matching heading; needs a build
	@bun $(VULCAN_BASE)/checks/wiki-anchors.ts $(WIKI_ANCHORS_FLAGS)
