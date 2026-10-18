# {{name}}. `make help` lists the targets. VULCAN's shared targets (okf-*, vulcan-*, atlas-*) come from the include.

# `-include`: a fresh clone has no node_modules yet, and `make install` must still run.
-include node_modules/@venizia/vulcan/base/make/vulcan.mk

# Without the include no shared target exists, and make would answer "No rule to make target" for each.
# This says what to do instead. A target the project defines itself (install) is untouched.
ifeq ($(wildcard node_modules/@venizia/vulcan/base/make/vulcan.mk),)
node_modules/@venizia/vulcan/base/make/vulcan.mk: ;
%:
	@echo "vulcan: node_modules/@venizia/vulcan is missing - run 'make install' (bun install) first" >&2; exit 1
endif
