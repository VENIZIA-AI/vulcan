# Lint and format the packages.

# Each package lints itself, from its own .configs/lints/ and .configs/formatters/ and with its own tools (its node_modules/.bin).
# oxlint owns the rules, ESLint runs only naming-convention (oxlint has no port yet), bun fmt formats.
LINT_PKG_TARGETS := $(addprefix lint-,$(PACKAGES))
FMT_PKG_TARGETS := $(addprefix fmt-,$(PACKAGES))
TYPECHECK_PKG_TARGETS := $(addprefix typecheck-,$(PACKAGES))

.PHONY: lint lint-fix lint-all lint-packages lint-scripts project-names-check fmt fmt-packages fmt-scripts \
        typecheck typecheck-packages $(LINT_PKG_TARGETS) $(FMT_PKG_TARGETS) $(TYPECHECK_PKG_TARGETS)

lint: lint-packages
	@echo "lint: done"

lint-all: lint-packages lint-scripts project-names-check
	@echo "lint: all packages done"

lint-packages: $(LINT_PKG_TARGETS)

fmt: fmt-packages fmt-scripts

# The library target set (build, typecheck, lint, lint-fix, test, clean): `lint-fix` is `fmt`.
lint-fix: fmt

typecheck: typecheck-packages

typecheck-packages: $(TYPECHECK_PKG_TARGETS)

fmt-packages: $(FMT_PKG_TARGETS)

# Static pattern rules: make skips implicit-rule search for .PHONY targets, so a plain `lint-%`
# would never match.
$(LINT_PKG_TARGETS): lint-%:
	@echo "lint: packages/$*"
	@$(MAKE) --no-print-directory -C packages/$* lint

$(FMT_PKG_TARGETS): fmt-%:
	@$(MAKE) --no-print-directory -C packages/$* fmt

$(TYPECHECK_PKG_TARGETS): typecheck-%:
	@echo "typecheck: packages/$*"
	@$(MAKE) --no-print-directory -C packages/$* typecheck

# The root scripts/ is not a workspace member: it formats with the root bunfig.toml and type-checks
# with its own tsconfig.
lint-scripts:
	@echo "lint: scripts"
	@bun fmt --check "scripts/**/*.{ts,mts}"
	@bun check --no-pretty -p scripts/tsconfig.json

# Project Contract v1, V1: VULCAN's shipped source names no project.
project-names-check:
	@echo "lint: no project names in packages/*/src"
	@bun scripts/check-project-names.ts

fmt-scripts:
	@bun fmt "scripts/**/*.{ts,mts}"
