---
title: guard-writes asks only about the commands in its table
description: guard-writes no longer reads scripts or asks about commands it cannot read; guard.writes.trustedScripts is removed.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-07

## guard-writes asks only about the commands in its table

<Badge type="warning" text="Behavior Change" />

**In one line.** `guard-writes` asks before a command of its table (`kubectl apply`, `terraform apply`, a `psql` write, `docker compose up`, a migration, `gh secret set` through your own patterns, the cloud CLIs) and before a command you list in `guard.writes.commands`. It no longer reads scripts, and the config key `guard.writes.trustedScripts` is removed.

## What changed

- **The table still asks, in every form the shell parser reads.** A table command is found inside `&&`, `;` and pipes, behind `sudo`, `env`, `timeout` and `xargs`, and inside the text of `sh -c`, `eval` and `$(...)`. `cat x.sql | psql`, `psql -f x.sql` and a `psql` with no SQL on the line still ask.
- **Scripts are not read.** `bun x.ts`, `node x.js`, `bash deploy.sh`, `./deploy.sh` and `bun run <name>` are no longer opened. A deploy or a database write hidden inside a script, a package script, the code of `node -e` or a here-string fed to a shell (`bash <<< "kubectl apply -f x"`) is no longer asked about. A heredoc fed to a shell (`bash <<EOF`) and a line piped into one (`echo ... | sh`) still ask.
- **A command it cannot read is no longer asked about.** A script that does not exist yet, a program named by a variable, a substitution, a glob or a brace pattern (`$k apply`, `kube*l apply`), a line the parser cannot read to its end, a startup file or a preloaded library (`BASH_ENV`, `LD_PRELOAD`, `NODE_OPTIONS --require`), and a program that `find -exec`, `fd --exec` or `xargs` takes from its input all pass `guard-writes` now. `guard-git` and `guard-outside` still ask about a line they cannot read.
- **Input the hook cannot read still asks**, as before.
- **`guard.writes.trustedScripts` is removed**, with the doctor notes and warnings about it. With no script reading, there was nothing left for it to skip.

## Who is affected

- **Every project that uses the shipped hooks:** fewer asks. The "does not exist yet" and "cannot work out" asks on `bun scripts/x.ts`, `bash scripts/...` and `bun run <name>` are gone. If you relied on the guard to see inside your own deploy or migrate script, add the command that starts it to `guard.writes.commands`, or to Claude Code's `permissions.ask`.
- **A project that sets `guard.writes.trustedScripts`:** the config is refused until you delete the key. `vulcan sync` and `vulcan doctor` say so: `removed: delete this key; ...`.

## Migration

Before, a config listing scripts:

```ts
export default {
  guard: {
    writes: {
      trustedScripts: ['auroras/tools/i18n/cli.ts'],
      commands: [{ rule: 'V-W-03', what: 'deploying', pattern: '\\bmake deploy-' }],
    },
  },
} satisfies VulcanConfig;
```

After, delete the key; `commands` stays:

```ts
export default {
  guard: {
    writes: {
      commands: [{ rule: 'V-W-03', what: 'deploying', pattern: '\\bmake deploy-' }],
    },
  },
} satisfies VulcanConfig;
```

A project that listed one script entry, such as `auroras/tools/i18n/cli.ts`, deletes that line and runs `bun x --no-install vulcan sync`.
