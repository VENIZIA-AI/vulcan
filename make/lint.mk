# Lint and format the packages.

# Each package lints itself, from its own .configs/ and with its own tools (its node_modules/.bin).
# oxlint owns the rules, ESLint runs only naming-convention (oxlint has no port yet), oxfmt formats.
LINT_PKG_TARGETS := $(addprefix lint-,$(PACKAGES))
FMT_PKG_TARGETS := $(addprefix fmt-,$(PACKAGES))

.PHONY: lint lint-all lint-packages lint-scripts project-names-check fmt fmt-packages fmt-scripts \
        $(LINT_PKG_TARGETS) $(FMT_PKG_TARGETS)

lint: lint-packages
	@echo "lint: done"

lint-all: lint-packages lint-scripts project-names-check
	@echo "lint: all packages done"

lint-packages: $(LINT_PKG_TARGETS)

fmt: fmt-packages fmt-scripts

fmt-packages: $(FMT_PKG_TARGETS)

# Static pattern rules: make skips implicit-rule search for .PHONY targets, so a plain `lint-%`
# would never match.
$(LINT_PKG_TARGETS): lint-%:
	@echo "lint: packages/$*"
	@$(MAKE) --no-print-directory -C packages/$* lint

$(FMT_PKG_TARGETS): fmt-%:
	@$(MAKE) --no-print-directory -C packages/$* fmt

# The root scripts/ is not a workspace member: it formats with its own .configs and type-checks with
# its own tsconfig, from the root package.json's tools.
lint-scripts:
	@echo "lint: scripts"
	@node_modules/.bin/oxfmt -c scripts/.configs/oxfmt.config.mts --check "scripts/**/*.{ts,mts}"
	@node_modules/.bin/tsc -p scripts/tsconfig.json

# Project Contract v1, V1: VULCAN's shipped source names no project.
project-names-check:
	@echo "lint: no project names in packages/*/src"
	@bun scripts/check-project-names.ts

fmt-scripts:
	@node_modules/.bin/oxfmt -c scripts/.configs/oxfmt.config.mts "scripts/**/*.{ts,mts}"
