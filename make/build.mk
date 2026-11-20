# Install, clean, git hooks, the package build order, and the force-update targets.

UPDATE_TARGETS := $(addprefix update-,$(PACKAGES))

.PHONY: install clean setup-hooks build build-all hooks-bundle docs $(PACKAGES) $(UPDATE_TARGETS)

# ----------------------------------------------------------------------------
# INSTALL & CLEAN
# ----------------------------------------------------------------------------
install:
	@echo "install: bun install"
	@bun install
	@echo "install: done"

clean:
	@echo "clean: all packages"
	@$(foreach p,$(PACKAGES),$(MAKE) --no-print-directory -C packages/$(p) clean &&) true

# ----------------------------------------------------------------------------
# GIT HOOKS
# ----------------------------------------------------------------------------
setup-hooks:
	@echo "hooks: core.hooksPath -> .githooks"
	@git config core.hooksPath .githooks
	@echo "hooks: done"

# ----------------------------------------------------------------------------
# BUILD TARGETS
# ----------------------------------------------------------------------------
build: build-all

build-all: $(PACKAGES)
	@echo "build: all packages done"

# Each package builds through its own Makefile (make/project.mk); this file only orders them.
$(PACKAGES):
	@echo ""
	@echo "build: $(call PKG_NAME,$@)"
	@$(MAKE) --no-print-directory -C packages/$@ rebuild

# The hooks of @venizia/vulcan, one self-contained file each in packages/cli/base/bundle: what `vulcan sync` copies into .agents/local/hooks.
# `make build` makes it too; run this alone before `make vulcan-sync` in a checkout that has not built.
hooks-bundle:
	@bun scripts/hooks-bundle/build.ts

# The wiki site has its own package and lockfile, so the npm packages never install VitePress.
docs:
	@echo "docs: VitePress site from docs/wiki/content"
	@cd docs/wiki && bun install --frozen-lockfile
	@bun scripts/wiki-shared/build.ts

# The shipped board page (packages/cli/base/templates/board.html), built from its components (packages/cli/src/board/ui); board-ui OUT=<file> builds somewhere else.
board-ui:
	@bun scripts/board-ui/build.ts $(OUT)

# ----------------------------------------------------------------------------
# FORCE UPDATE TARGETS (fetch latest from NPM registry)
# ----------------------------------------------------------------------------
$(UPDATE_TARGETS): update-%:
	@echo "update: $(call PKG_NAME,$*) (forced)"
	@bun run --filter "$(call PKG_NAME,$*)" force-update
