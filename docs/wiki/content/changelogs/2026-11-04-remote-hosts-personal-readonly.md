---
title: Read-only hosts can live in your personal hosts file, and a loose line there no longer trusts every host
description: "A readonly: line in the personal remoteHosts.localFile adds a read-only host without naming it in the tracked config, and every entry of that file is now checked like the config lists."
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-04

## Read-only hosts can live in your personal hosts file, and a loose line there no longer trusts every host

<Badge type="tip" text="New Feature" />
<Badge type="info" text="Behavior Change" />
<Badge type="warning" text="Security" />
<Badge type="warning" text="Breaking Change" />

**In one line.** `readonly: <host>` in `.agents/hooks/trusted-hosts.local` adds a read-only host, and a line of that file that is not a host name or a `*` pattern is skipped instead of trusted.

## What changed

- **Read-only hosts in the personal file.** A project no longer has to name its production hosts in the tracked `remoteHosts.readOnly`. Put `readonly: db-replica.lan` (or `readonly: $PROD_S1`) in the gitignored personal file: only the strict read-only forms reach that host without asking. A plain line is still a trusted host. No `vulcan sync` is needed; the hook reads the file when it runs.
- **Every entry is checked.** The personal file used to trust each line as written, so a lone `*` trusted every host. Each entry now follows the rule of `remoteHosts.trusted` and `readOnly`: a host name or a `*` pattern with at least one other character, or a `$VAR`; never a user, a path or a port. A line that does not is skipped, never trusted, and the hook says so once on stderr with the line numbers.
- **A pattern needs a letter or a digit.** This applies to the config lists and the personal file alike. `-`, `_`, `*-*` and `*_*` used to pass, and `*-*` matched every hyphenated host. They are refused now. `*-db`, `prod-*` and `$PROD_S1` are fine. A pattern such as `*e*` has a letter, so it is still valid, but it matches any host name with an `e`: name hosts as narrowly as you can.
- **Older hooks.** A hook from before this change reads a `readonly: ...` line as a trusted entry that matches no host, so it trusts nothing and does not fail.

## Who is affected

- **Projects whose personal file holds a `*`, a `-`, a `*-*`, a `user@host`, a port or a path:** that line no longer trusts anything. List the host by name or pattern.
- **Projects whose `.configs/vulcan.config.*` lists `-`, `_`, `*-*` or `*_*` in `remoteHosts.trusted` or `readOnly`:** the config no longer loads and the error names the entry. Replace it with a host name or a narrower pattern, then run `vulcan sync`.
- **Everyone else:** nothing changes.
