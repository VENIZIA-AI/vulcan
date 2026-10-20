# The shared build and lint targets of one package. A package Makefile sets the variables below
# and includes this file.
#
#   FORMATS      cjs (default) | plain - cjs emits dist/cjs; plain emits nothing, `build` only type-checks
#   CJS_TSCONFIG the program the CJS pass emits (default .configs/tsconfig.build.json)
#   CJS_OUT      where the CJS pass lands (default dist/cjs); empty: the tsconfig's own outDir
#   POST_BUILD   a shell step only this package has, run after the emit
#
# Every tool comes from the package's node_modules/.bin, by absolute path: a recipe never depends on
# PATH (`sh ./scripts/build.sh` once died at `tsc-alias: not found` with half the output emitted).

BIN := $(CURDIR)/node_modules/.bin
TSC := $(BIN)/tsc
TSC_ALIAS := $(BIN)/tsc-alias

# Type-checking runs through Bun (>= 1.4.3), which reports what tsc reports; tsc stays only where it
# emits.
TYPECHECK := bun check --no-pretty

FORMATS ?= cjs
CJS_TSCONFIG ?= .configs/tsconfig.build.json
CJS_OUT ?= dist/cjs

# The programs `build` emits, each type-checked before `rebuild` deletes dist: one that fails after
# clean leaves an empty dist.
EMIT_TSCONFIGS := $(if $(filter cjs,$(FORMATS)),$(CJS_TSCONFIG))

FMT_GLOB := "**/*.{ts,mts,js,mjs}"

.PHONY: build typecheck clean rebuild lint lint-fix fmt

# tsconfig.json covers the tests too, so a broken test fails here, before anything is emitted.
typecheck:
	@$(TYPECHECK) -p tsconfig.json
	@for config in $(filter-out tsconfig.json,$(EMIT_TSCONFIGS)); do $(TYPECHECK) -p $$config || exit 1; done

# tsc-alias reads the ROOT tsconfig: pointed at a .configs/ file it resolves `paths` against
# .configs/ and leaves every `@/` import unrewritten.
build:
	@echo "START | Building $(notdir $(CURDIR))..."
	@$(TYPECHECK) -p tsconfig.json
ifneq ($(filter cjs,$(FORMATS)),)
	@echo ">>> Building CJS..."
	@$(TSC) -p $(CJS_TSCONFIG) --extendedDiagnostics
	@$(TSC_ALIAS) -p tsconfig.json $(if $(CJS_OUT),--outDir $(CJS_OUT))
endif
	$(if $(POST_BUILD),@$(POST_BUILD))
	@echo "DONE | Build completed."

# A stale .tsbuildinfo next to a .configs/ tsconfig makes tsc think it is up to date and emit
# nothing - a "DONE" build with an empty dist.
clean:
	@rm -rf dist *.tsbuildinfo .configs/*.tsbuildinfo .eslintcache artifact.zip

# Type-check before cleaning: a failure after clean leaves an empty dist, which looks like a hundred
# unrelated import failures downstream.
rebuild: typecheck clean
	@$(MAKE) --no-print-directory build

lint:
	@$(BIN)/oxlint -c .configs/oxlint.config.mts --deny-warnings .
	@$(BIN)/eslint -c .configs/eslint.config.mjs .
	@$(BIN)/oxfmt -c .configs/oxfmt.config.mts --check $(FMT_GLOB)

# The library target set is build, typecheck, lint, lint-fix, test, clean; `fmt` is the same as `lint-fix`.
lint-fix: fmt

fmt:
	@$(BIN)/oxlint -c .configs/oxlint.config.mts --fix .
	@$(BIN)/eslint -c .configs/eslint.config.mjs --fix .
	@$(BIN)/oxfmt -c .configs/oxfmt.config.mts $(FMT_GLOB)
