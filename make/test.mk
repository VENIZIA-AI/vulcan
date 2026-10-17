# Package test suites.

# Packages whose package.json owns the test command (NODE_ENV=test + .env.test); `bun run` appends
# the flags to it. The rest run `bun test` directly.
TEST_SCRIPT := okf atlas cli

TEST_TARGETS := $(addprefix test-,$(PACKAGES))

.PHONY: test test-all test-scripts $(TEST_TARGETS)

# ----------------------------------------------------------------------------
# TEST TARGETS
# The one home of the test flags. `--parallel` runs the files across worker processes and implies
# `--isolate`, so a mock, env or TLS setting one file leaks cannot pass or fail another.
# Atlas's repo-mode and generator tests read the sibling IGNIS checkout (IGNIS_ROOT overrides, tests only).
# ----------------------------------------------------------------------------
BUN_TEST_FLAGS ?= --parallel
# Packages whose tests run serially. Bun 1.4's parallel workers sometimes never reap a synchronous git
# child (a <defunct> git under a stalled worker): atlas hung 1 run in 6 that way, 0 in 15 serially.
SERIAL_TESTS := atlas

test: test-all

test-all: $(TEST_TARGETS) test-scripts

# The root scripts/ (force-update and the release tooling) have their own tests.
test-scripts:
	@bun test scripts $(BUN_TEST_FLAGS)

$(TEST_TARGETS): test-%:
	@cd packages/$* && $(if $(filter $*,$(TEST_SCRIPT)),bun run test,bun test) $(if $(filter $*,$(SERIAL_TESTS)),,$(BUN_TEST_FLAGS))

# ----------------------------------------------------------------------------
# SMOKE TARGETS
# Packs a package, installs the tarball alone into an empty project and runs it. Needs a build first.
# ----------------------------------------------------------------------------
SMOKE_TARGETS := smoke-atlas smoke-cli

.PHONY: $(SMOKE_TARGETS)

$(SMOKE_TARGETS): smoke-%:
	@echo "smoke: packages/$*"
	@bun packages/$*/scripts/pack-smoke.ts
