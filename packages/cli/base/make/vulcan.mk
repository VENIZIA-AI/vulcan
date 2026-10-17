# Shipped by @venizia/vulcan - include it, never copy it:
#   -include node_modules/@venizia/vulcan/base/make/vulcan.mk
# A project adds its own targets after the include; redefining one of these fails `vulcan doctor`.

VULCAN ?= bun x --no-install vulcan

.PHONY: vulcan-sync vulcan-doctor agent-setup okf-check okf-check-strict okf-gen okf-coverage okf-viz \
        surface-gen surface-check symbols-gen symbols-check releases-gen releases-check

vulcan-sync:
	@$(VULCAN) sync

vulcan-doctor:
	@$(VULCAN) doctor

# The IGNIS name for the same job, kept for muscle memory.
agent-setup: vulcan-sync

# OKF v0.2 conformance only; okf-check-strict adds the house rules (links, style, coverage, freshness).
okf-check:
	@$(VULCAN) x okf check

okf-check-strict:
	@$(VULCAN) x okf check --strict

okf-gen:
	@$(VULCAN) x okf gen

okf-coverage:
	@$(VULCAN) x okf coverage

okf-viz:
	@$(VULCAN) x okf viz

# The Atlas tables. surface and symbols read the built .d.ts - build first.
surface-gen:
	@$(VULCAN) x atlas surface gen

surface-check:
	@$(VULCAN) x atlas surface check

symbols-gen:
	@$(VULCAN) x atlas symbols gen

symbols-check:
	@$(VULCAN) x atlas symbols check

releases-gen:
	@$(VULCAN) x atlas releases gen

releases-check:
	@$(VULCAN) x atlas releases check
