---
title: "VULCAN 0.3.11: --scope Gives an App's Package a Scope"
description: init --preset and add --app take --scope, as add --lib already does, and name the app's package @scope/<app>. The folder and the registered dir stay bare.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-22

## VULCAN 0.3.11: `--scope` names an app's package `@scope/<app>`

<Badge type="info" text="Feature" />

**In one line.** `vulcan add --app web --scope @acme` creates `apps/web` whose `package.json` is named `@acme/web`.

## What changed

- **`--scope <@scope>` for apps.** `init --preset` (the first app) and `add --app` name the package `@scope/<app>`, the way `add --lib --scope` already named a library. The folder (`apps/web`) and the `dir` registered in the config stay bare, so `--api <backend app>` still names an app by its folder.
- **Never inferred.** An app without `--scope` keeps the bare name, whatever scope the other packages have.
- **A menu asks, optionally.** Where menus are drawn, `init` and `add --app` ask "Package scope (optional, like @acme; empty for none)" after the app name, and the summary shows the `package` row. A plain terminal and a script do not get the new question; they give the flag.
- **Checked.** A scope that is not `@lowercase-name` is refused (`--scope 'acme' is not a scope like @acme`) before anything is written, and a package name that already exists is refused.
- **`--help`** lists `--scope` under `init --preset` and `add`.

## Who is affected

- **Everyone who scripts `init --preset` or `add --app`:** nothing changes unless you pass `--scope`.
