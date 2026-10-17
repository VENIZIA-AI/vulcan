---
type: Playbook
title: Development
description: The gates to run before a change is done.
tags: [process, testing, lint]
---

# Development

```bash
make lint-all          # every package, then scripts/
make test              # every package suite (--parallel), then scripts/
make catalog-check
make smoke-atlas smoke-cli
bun x --no-install vulcan doctor
bun x --no-install vulcan x okf check
```

- Tests first: a test that fails, then the change.
- A change that touches the generators or okf is checked against IGNIS read-only: `check` from
  inside IGNIS must stay fresh. Never run `gen` there.
- `vulcan x atlas` runs atlas's built `dist`; run `make atlas` before checking it that way.
