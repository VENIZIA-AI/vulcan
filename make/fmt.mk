# What `bun fmt` formats, shared by the root (make/lint.mk) and the packages (make/project.mk).
#
# Always a glob: a bare `bun fmt` also formats Markdown. Code, JSON, YAML, CSS, HTML and Vue are in
# (the same list in IGNIS, ARDOR and VULCAN); Markdown stays out, its table padding is not wanted.
# bun fmt skips what git ignores (node_modules, dist), and bun.lock has no extension in the list. The
# [fmt] section of the root bunfig.toml decides the style (flavor = "oxfmt" keeps oxfmt's output);
# --no-script keeps a `fmt` script of the package from taking over.
BUN_FMT_FLAGS := --no-script
FMT_GLOB := "**/*.{ts,mts,tsx,js,mjs,json,jsonc,yml,yaml,css,html,vue}"

# Paths kept out of format, one pattern per line (blank lines and # comments are skipped), read from
# .configs/formatters/.ignore of the folder make runs in: bun fmt does not read the file by itself.
# A fixture a test compares byte for byte goes there instead of being reformatted.
IGNORE_LINES = $(shell sed -e '/^\#/d' -e '/^$$/d' $(1) 2>/dev/null)
FMT_IGNORE := $(foreach pattern,$(call IGNORE_LINES,.configs/formatters/.ignore),--ignore-pattern '$(pattern)')
