---
title: V-C-13 lets a project name an exception to a native docs site
description: The base rule V-C-13 keeps a docs site native to its generator unless the project's own rules name an exception.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-08

## V-C-13 lets a project name an exception to a native docs site

<Badge type="info" text="Fix" />

**In one line.** `V-C-13` said the docs site stays native to its generator, with no custom components or theme CSS, and gave a project that has a custom docs theme no way to say so. It now ends: "unless the project's own rules name an exception".

## What changed

- **`V-C-13` of the base rules** ends its docs-site sentence with "unless the project's own rules name an exception". Nothing else in the rule changes: a project that names none is held to the native site as before. `vulcan sync` reports the changed rule once.

## Who is affected

A project with its own docs theme should add an exception row to its `.agents/rules.md`, naming the folder the theme lives in. Every other project is unaffected. Nothing to do.
