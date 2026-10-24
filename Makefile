# The VULCAN monorepo. Each file under make/ holds one job; `make help` lists every target.
# make/project.mk is not included here: it is the per-package include, used by packages/*/Makefile.

# A bare `make` prints the target list; `make build` builds.
.DEFAULT_GOAL := help

# Every package directory under packages/. Each per-package target (`<pkg>`, `update-<pkg>`,
# `lint-<pkg>`, `fmt-<pkg>`, `test-<pkg>`) is generated from this list - add a package here and
# every target exists for it.
PACKAGES := okf atlas cli

# The npm name of a package directory, read from its package.json: $(call PKG_NAME,atlas).
PKG_NAME = $(shell sed -n 's/^  "name": "\(.*\)",$$/\1/p' packages/$(1)/package.json)

# The shipped VULCAN targets (sync, doctor, okf-*, surface/symbols/releases), exactly as every project gets them.
-include node_modules/@venizia/vulcan/base/make/vulcan.mk
include make/build.mk
include make/lint.mk
include make/test.mk
include make/release.mk
include make/evals.mk
include make/help.mk
