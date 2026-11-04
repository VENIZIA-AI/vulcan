---
title: vulcan doctor warns when a committed file holds a private value
description: A new warning lists the tracked files that hold a private key, a token, URL credentials, an IP address or a machine path, and a new doctor.privateValues.acknowledged key records the ones a project keeps on purpose.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-04

## `vulcan doctor` warns when a committed file holds a private value

<Badge type="tip" text="New Feature" />

**In one line.** `vulcan doctor` now names the tracked files that hold a private key, a token, a password in a URL, an IP address or a machine path, and never prints the value.

## What changed

- **A new warning, `private-values`.** It reads the files git tracks (text, up to 1 MB) and prints one warning per file with the kinds and how many, for example `holds private values: 1 private-key, 2 ipv4 (not shown)`. It is a warning: the exit code stays `0`.
- **What it looks for.** A private-key header; the known token prefixes (GitHub, npm, OpenAI-style `sk-`, AWS, Google, GitLab, Stripe, Slack, JWT, `Basic` and `Bearer`); `user:password@` in a URL; an IPv4 address other than loopback, `0.0.0.0`, broadcast and the documentation ranges; a machine path (`/home/<user>/`, `/Users/<user>/`, `C:\Users\<user>\`).
- **What it leaves alone.** Lockfiles, `.drawio`, `.snap`, files under `__tests__/`, `fixtures/` and `golden/` and files named `*.test.*`, because they hold hashes and fake values on purpose. It does not scan for host names or for `name = value` shapes: on a tree of 28,000 files the second one matched about 117,000 times, almost all noise.
- **Acknowledge on purpose.** A project that knowingly commits development credentials until it has a secret store lists them in `doctor.privateValues.acknowledged`, each as `{ path, kinds?, reason }` with a required `reason`. The files are not warned about one by one; a note counts them (`2 files acknowledged in doctor.privateValues.acknowledged`), so the check never goes silent and a fully acknowledged project still prints a plain OK. An entry that covers nothing is a warning, so a stale or broad one is seen. A comment cannot silence a line.
- **Speed.** On a tree of 28,000 tracked files the scan took 3 seconds, on top of a doctor run of 1 second.

## Who is affected

- **Projects with a private value in a tracked file:** a new warning, nothing fails. Remove the value and rotate it, or record the decision.
- **Everyone else:** nothing changes.
