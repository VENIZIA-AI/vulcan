# The shared build and lint targets of one package. A package Makefile sets the variables below
# and includes this file.
#
#   FORMATS      esm (default) | plain - esm emits dist/esm; plain emits nothing, `build` only type-checks
#   ESM_TSCONFIG the program the ESM pass emits (default .configs/builders/tsconfig.build.json)
#   ESM_OUT      where the ESM pass lands (default dist/esm); empty: the tsconfig's own outDir
#   POST_BUILD   a shell step only this package has, run after the emit
#
# Every tool comes from the package's node_modules/.bin, by absolute path: a recipe never depends on
# PATH (a shell script once died at `tsc-alias: not found` with half the output emitted).

BIN := $(CURDIR)/node_modules/.bin

# The compile cache of the Node tools lives in the repository, not the system temp (the root Makefile sets
# the same path; a package built alone gets it here).
export NODE_COMPILE_CACHE ?= $(abspath $(CURDIR)/../../.agents/local/cache/node-compile)
TSC := $(BIN)/tsc
TSC_ALIAS := $(BIN)/tsc-alias

# Type-checking and formatting run through Bun (>= 1.4.4): `bun check` reports what tsc reports (tsc
# stays only where it emits), `bun fmt` formats with the [fmt] section of the root bunfig.toml.
TYPECHECK := bun check --no-pretty

FORMATS ?= esm
ESM_TSCONFIG ?= .configs/builders/tsconfig.build.json
ESM_OUT ?= dist/esm

# The programs `build` emits, each type-checked before `rebuild` deletes dist: one that fails after
# clean leaves an empty dist.
EMIT_TSCONFIGS := $(if $(filter esm,$(FORMATS)),$(ESM_TSCONFIG))

include $(dir $(lastword $(MAKEFILE_LIST)))fmt.mk

# Paths a package keeps out of lint, one pattern per line (blank lines and # comments are skipped):
# .configs/lints/.ignore feeds oxlint and ESLint (.configs/formatters/.ignore feeds bun fmt, see
# fmt.mk). It lives beside the configs because oxlint resolves ignore patterns from the config's own
# folder and refuses '..': a config in .configs/ cannot ignore package paths itself.
LINT_IGNORE := $(foreach pattern,$(call IGNORE_LINES,.configs/lints/.ignore),--ignore-pattern $(pattern))

.PHONY: build typecheck clean rebuild lint lint-fix

# tsconfig.json covers the tests too, so a broken test fails here, before anything is emitted.
typecheck:
	@$(TYPECHECK) -p tsconfig.json
	@for config in $(filter-out tsconfig.json,$(EMIT_TSCONFIGS)); do $(TYPECHECK) -p $$config || exit 1; done

# --resolve-full-paths writes the file extension on every relative import: without it a nodenext consumer
# of the declarations silently loses the types.
# tsc-alias reads the ROOT tsconfig: pointed at a .configs/ file it resolves `paths` against
# .configs/ and leaves every `@/` import unrewritten.
build:
	@echo "START | Building $(notdir $(CURDIR))..."
	@$(TYPECHECK) -p tsconfig.json
ifneq ($(filter esm,$(FORMATS)),)
	@echo ">>> Building ESM..."
	@$(TSC) -p $(ESM_TSCONFIG) --extendedDiagnostics
	@$(TSC_ALIAS) -p tsconfig.json --resolve-full-paths $(if $(ESM_OUT),--outDir $(ESM_OUT))
endif
	$(if $(POST_BUILD),@$(POST_BUILD))
	@echo "DONE | Build completed."

# A stale .tsbuildinfo next to a .configs/ tsconfig makes tsc think it is up to date and emit
# nothing - a "DONE" build with an empty dist.
clean:
	@rm -rf dist *.tsbuildinfo .configs/*/*.tsbuildinfo .eslintcache artifact.zip

# Type-check before cleaning: a failure after clean leaves an empty dist, which looks like a hundred
# unrelated import failures downstream.
rebuild: typecheck clean
	@$(MAKE) --no-print-directory build

lint:
	@$(BIN)/oxlint -c .configs/lints/oxlint.config.mts --deny-warnings $(LINT_IGNORE) .
	@$(BIN)/eslint -c .configs/lints/eslint.config.mjs $(LINT_IGNORE) .
	@bun fmt $(BUN_FMT_FLAGS) --check $(FMT_GLOB) $(FMT_IGNORE)

# The library target set is build, typecheck, lint, lint-fix, test, clean.
lint-fix:
	@$(BIN)/oxlint -c .configs/lints/oxlint.config.mts --fix $(LINT_IGNORE) .
	@$(BIN)/eslint -c .configs/lints/eslint.config.mjs --fix $(LINT_IGNORE) .
	@bun fmt $(BUN_FMT_FLAGS) $(FMT_GLOB) $(FMT_IGNORE)
