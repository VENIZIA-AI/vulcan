---
title: The skill evals are removed
description: The evals/evals.json file of each shipped skill, the make targets that ran them and the testing-reference section about them are gone.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-08

## The skill evals are removed

<Badge type="warning" text="Breaking" />

**In one line.** Each shipped skill carried an `evals/evals.json`, run against models by two make targets that spent quota. Nothing in a project read them, and the package no longer ships them.

## What changed

- The `evals/` folder of the 11 shipped skills is removed from the package, so it is no longer in `.claude/skills/<name>/` after `vulcan sync`.
- The "Evals for skills and rules" section of the shipped `testing.md` reference is removed, and the "Checking a skill" section of the skills page with it.
- The `make skill-evals` and `make skill-evals-plan` targets were in the VULCAN repository only, never in a project's `vulcan.mk`; they are removed there.

## Who is affected

A project that read a skill's `evals/evals.json` or linked to the "Evals" section of `testing.md` finds neither. No command, hook or check of a project used them.
