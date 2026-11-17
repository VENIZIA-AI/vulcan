---
title: The guard-remote-hosts hook and the remoteHosts key are removed
description: VULCAN no longer asks before a command reaches a host you did not list; the remoteHosts config key and the personal trusted-hosts file are gone, and a config that still sets the key is refused with a pointer.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-07

## The `guard-remote-hosts` hook and the `remoteHosts` key are removed

<Badge type="warning" text="Breaking Change" />

**In one line.** The hook that asked before a Bash command reached a host you had not listed is gone, with the `remoteHosts` config key it read and the personal file `.agents/hooks/trusted-hosts.local`. The host's own permission rules (for Claude Code, `permissions` in `.claude/settings.json`) cover network access.

## What changed

- **No question before an `ssh`, `scp`, `curl` or `kubectl` to an unlisted host.** The hook only ran in a project that set `remoteHosts`. It started a process on every Bash call and loaded about 1,100 lines of code to do it.
- **The `remoteHosts` key is gone** from the config, with `trusted`, `readOnly` and `localFile`, and from the manifest `.agents/vulcan.manifest.json`.
- **`vulcan init` no longer writes** `.agents/hooks/trusted-hosts.local.example`, no longer adds `.agents/hooks/trusted-hosts.local` to `.gitignore`, and no longer prints the "private hosts go in" step.
- **A config that still sets `remoteHosts` is refused.** `vulcan sync` and every other command that reads the config exit with `remoteHosts: removed: ...`, which says to delete the key and the personal file.
- **The page `references/hooks/remote-host-guard` is removed**, with its entry in the sidebar.
- **An old hook entry is harmless for one release.** The entry an earlier `vulcan sync` wrote for this hook would block every call once its file is gone, so `base/hooks/guard-remote-hosts.ts` stays as an empty file that exits 0. Delete the `remoteHosts` key, then run `vulcan sync`; the entry disappears from `.claude/settings.json`.

## Who is affected

- **A project that sets `remoteHosts`:** `vulcan sync` stops with an error until you delete the key. This is the one step you must take.
- **Every other project:** after `vulcan upgrade` (or a version bump and `vulcan sync`) nothing changes except that one process fewer runs on each Bash call.

## Migration

Before, a config with a host list, and a personal file next to it:

```ts
export default {
  remoteHosts: {
    trusted: ['lab1'],
    readOnly: ['prod1'],
  },
} satisfies VulcanConfig;
```

```text
.agents/hooks/trusted-hosts.local
```

After, neither exists. Delete the `remoteHosts` key from `.configs/vulcan.config.*`, delete `.agents/hooks/trusted-hosts.local` and the `.example` file if `init` wrote one, then run `vulcan sync`. Sync takes the `guard-remote-hosts` entry out of `.claude/settings.json` and the `remoteHosts` block out of the manifest. The `.gitignore` line for the personal file can stay or go.

If you still want a question before a command reaches a host, put the rule in the host's own permissions, for example `permissions.ask` in `claude.settings` of the config:

```ts
export default {
  claude: { settings: { permissions: { ask: ['Bash(ssh:*)', 'Bash(scp:*)'] } } },
} satisfies VulcanConfig;
```
