# Lint and format the packages.

# Each package lints itself, from its own .configs/lints/ and with its own tools (its node_modules/.bin); `bun fmt` formats with the root bunfig.toml.
# oxlint owns the rules, ESLint runs only naming-convention (oxlint has no port yet), bun fmt formats.
LINT_PKG_TARGETS := $(addprefix lint-,$(PACKAGES))
FIX_PKG_TARGETS := $(addprefix lint-fix-,$(PACKAGES))
TYPECHECK_PKG_TARGETS := $(addprefix typecheck-,$(PACKAGES))

.PHONY: lint lint-fix lint-all lint-packages lint-scripts lint-wiki lint-files project-names-check lint-fix-packages lint-fix-wiki fmt-files \
        typecheck typecheck-packages $(LINT_PKG_TARGETS) $(FIX_PKG_TARGETS) $(TYPECHECK_PKG_TARGETS)

lint: lint-packages
	@echo "lint: done"

lint-all: lint-packages lint-wiki lint-scripts lint-files project-names-check
	@echo "lint: all packages done"

lint-packages: $(LINT_PKG_TARGETS)

# The library target set (build, typecheck, lint, lint-fix, test, clean): `lint-fix` is the root fix
# target in all three repos, it applies the fixes and the format to the packages and to the root files.
lint-fix: lint-fix-packages lint-fix-wiki fmt-files

typecheck: typecheck-packages

typecheck-packages: $(TYPECHECK_PKG_TARGETS)

lint-fix-packages: $(FIX_PKG_TARGETS)

# Static pattern rules: make skips implicit-rule search for .PHONY targets, so a plain `lint-%`
# would never match.
$(LINT_PKG_TARGETS): lint-%:
	@echo "lint: packages/$*"
	@$(MAKE) --no-print-directory -C packages/$* lint

$(FIX_PKG_TARGETS): lint-fix-%:
	@$(MAKE) --no-print-directory -C packages/$* lint-fix

$(TYPECHECK_PKG_TARGETS): typecheck-%:
	@echo "typecheck: packages/$*"
	@$(MAKE) --no-print-directory -C packages/$* typecheck

# The wiki is a project of its own (docs/wiki, its own lockfile, outside the workspace) linted with the rules of the
# other two wikis: oxlint owns the rules, ESLint runs the house rules (its naming rule skips site/, which spells the
# keys the VitePress theme API reads). The shared theme folder (site/.vitepress/theme/shared) is canonical here, so
# it is linted here, at its source, and the other wikis copy it unedited. Its dependencies are installed first.
WIKI_LINT := cd docs/wiki && bun install --frozen-lockfile --silent && node_modules/.bin/oxlint -c .configs/lints/oxlint.config.mts

lint-wiki:
	@echo "lint: docs/wiki"
	@$(WIKI_LINT) --deny-warnings . && node_modules/.bin/eslint -c .configs/lints/eslint.config.mjs .

lint-fix-wiki:
	@$(WIKI_LINT) --fix . && node_modules/.bin/eslint -c .configs/lints/eslint.config.mjs --fix .

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
	@bun scripts/checks/check-project-names.ts

fmt-files:
	@bun fmt $(BUN_FMT_FLAGS) $(FMT_GLOB) $(ROOT_FMT_IGNORE)
