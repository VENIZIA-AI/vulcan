# Lint and format the packages.

# Each package lints itself, from its own .configs/ and with its own tools (its node_modules/.bin).
# oxlint owns the rules, ESLint runs only naming-convention (oxlint has no port yet), oxfmt formats.
LINT_PKG_TARGETS := $(addprefix lint-,$(PACKAGES))
FMT_PKG_TARGETS := $(addprefix fmt-,$(PACKAGES))

.PHONY: lint lint-all lint-packages fmt fmt-packages \
        $(LINT_PKG_TARGETS) $(FMT_PKG_TARGETS)

lint: lint-packages
	@echo "lint: done"

lint-all: lint-packages
	@echo "lint: all packages done"

lint-packages: $(LINT_PKG_TARGETS)

fmt: fmt-packages

fmt-packages: $(FMT_PKG_TARGETS)

# Static pattern rules: make skips implicit-rule search for .PHONY targets, so a plain `lint-%`
# would never match.
$(LINT_PKG_TARGETS): lint-%:
	@echo "lint: packages/$*"
	@$(MAKE) --no-print-directory -C packages/$* lint

$(FMT_PKG_TARGETS): fmt-%:
	@$(MAKE) --no-print-directory -C packages/$* fmt
