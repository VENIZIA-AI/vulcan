# Package test suites.

# The test environment, in one place (no committed env file). Every package runs with it; atlas also
# reads the sibling IGNIS checkout its repo-mode and generator tests need (IGNIS_ROOT overrides, tests only).
TEST_ENV := NODE_ENV=test APP_ENV_LOGGER_LEVEL=error
TEST_ENV_atlas := NODE_ENV=test APP_ENV_LOGGER_LEVEL=warn IGNIS_ROOT=../../../ignis

# Every test and smoke makes its temp folders under here, inside the repository and gitignored: nothing
# is written to the system temp directory. git is told not to look above it, so a test project is never
# taken for part of this repository, and the empty `.git` marker is where bun's own ignore lookup stops
# (it would otherwise read this repository's .gitignore, which ignores .agents/local/, and `bun fmt`
# in a test project would then see no files).
TEST_TMP := $(CURDIR)/.agents/local/tmp/tests
TEST_TMP_ENV := TMPDIR=$(TEST_TMP) GIT_CEILING_DIRECTORIES=$(TEST_TMP)

TEST_TARGETS := $(addprefix test-,$(PACKAGES))

.PHONY: test test-all test-scripts $(TEST_TARGETS)

# ----------------------------------------------------------------------------
# TEST TARGETS
# The one home of the test flags. `--parallel` runs the files across worker processes and implies
# `--isolate`, so a mock, env or TLS setting one file leaks cannot pass or fail another.
# ----------------------------------------------------------------------------
BUN_TEST_FLAGS ?= --parallel
# Packages whose tests run serially. Bun 1.4's parallel workers sometimes never reap a synchronous git
# child (a <defunct> git under a stalled worker): atlas hung 1 run in 6 that way, 0 in 15 serially.
SERIAL_TESTS := atlas

test: test-all

test-all: $(TEST_TARGETS) test-scripts

# The root scripts/ (release, checks, build, evals, wiki-shared) have their own tests, in each group's __tests__/.
# The wiki's own dependencies are installed first: one test checks the VitePress pieces the shared theme overrides.
test-scripts:
	@cd docs/wiki && bun install --frozen-lockfile --silent
	@mkdir -p $(TEST_TMP)/.git && $(TEST_TMP_ENV) bun test scripts $(BUN_TEST_FLAGS)

$(TEST_TARGETS): test-%:
	@mkdir -p $(TEST_TMP)/.git && cd packages/$* && $(TEST_TMP_ENV) $(or $(TEST_ENV_$*),$(TEST_ENV)) bun test $(if $(filter $*,$(SERIAL_TESTS)),,$(BUN_TEST_FLAGS))

# ----------------------------------------------------------------------------
# SMOKE TARGETS
# Packs a package, installs the tarball alone into an empty project and runs it. Needs a build first.
# ----------------------------------------------------------------------------
SMOKE_TARGETS := smoke-atlas smoke-cli

.PHONY: $(SMOKE_TARGETS)

$(SMOKE_TARGETS): smoke-%:
	@echo "smoke: packages/$*"
	@mkdir -p $(TEST_TMP)/.git && $(TEST_TMP_ENV) bun scripts/build/pack-smoke-$*.ts
