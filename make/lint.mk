# Lint and format the packages.

# Each package lints itself, from its own .configs/lints/ and with its own tools (its node_modules/.bin); `bun fmt` formats with the root bunfig.toml.
# oxlint owns the rules, ESLint runs only naming-convention (oxlint has no port yet), bun fmt formats.
LINT_PKG_TARGETS := $(addprefix lint-,$(PACKAGES))
FMT_PKG_TARGETS := $(addprefix fmt-,$(PACKAGES))
TYPECHECK_PKG_TARGETS := $(addprefix typecheck-,$(PACKAGES))

.PHONY: lint lint-fix lint-all lint-packages lint-scripts lint-files project-names-check fmt fmt-packages fmt-files \
        typecheck typecheck-packages $(LINT_PKG_TARGETS) $(FMT_PKG_TARGETS) $(TYPECHECK_PKG_TARGETS)

lint: lint-packages
	@echo "lint: done"

lint-all: lint-packages lint-scripts lint-files project-names-check
	@echo "lint: all packages done"

lint-packages: $(LINT_PKG_TARGETS)

fmt: fmt-packages fmt-files

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

# The root scripts/ is not a workspace member: it type-checks with its own tsconfig.
lint-scripts:
	@echo "lint: scripts"
	@bun check --no-pretty -p scripts/tsconfig.json

# Everything outside packages/ (the root files, scripts/, docs/, .github/, .agents/): the packages
# format themselves. The same globs as a package, from make/fmt.mk.
include make/fmt.mk
ROOT_FMT_IGNORE := --ignore-pattern 'packages/**' $(FMT_IGNORE)

lint-files:
	@echo "lint: root files"
	@bun fmt $(BUN_FMT_FLAGS) --check $(FMT_GLOB) $(ROOT_FMT_IGNORE)

# Project Contract v1, V1: VULCAN's shipped source names no project.
project-names-check:
	@echo "lint: no project names in packages/*/src"
	@bun scripts/check-project-names.ts

fmt-files:
	@bun fmt $(BUN_FMT_FLAGS) $(FMT_GLOB) $(ROOT_FMT_IGNORE)
