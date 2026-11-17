---
title: The base rules are trimmed from 52 to 40
description: Twelve base rule IDs are gone, each merged into a rule that stays or deleted, and thirteen rules are shorter; a project that extends a removed ID fails vulcan doctor until it points at the new one.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-07

## The base rules are trimmed from 52 to 40

<Badge type="warning" text="Breaking Change" />

**In one line.** Twelve base rule IDs no longer exist, thirteen rules are shorter, and the base now carries 40 rules (W 4, S 6, P 10, B 7, C 13). A project whose `.agents/rules.md` says `Extends V-W-04` (or any other removed ID) fails `vulcan doctor` until it names the rule that took its place. Nothing else in a project has to change.

## What changed

**Twelve IDs are gone.** An ID the base drops is never reused.

| Removed ID | What happened to it |
|---|---|
| `V-W-04` | Merged into `V-W-06`: class C now also names deleting files you did not create, discarding uncommitted changes and an API call with side effects. |
| `V-S-07` | Merged into `V-S-01`, which now says no secrets or PII in logs, errors and telemetry too. |
| `V-P-03` | Merged into `V-P-02`: a plan needs the human's approval before any code. |
| `V-P-09` | Merged into `V-P-11`: the work card and the done report. |
| `V-B-01` | Merged into `V-B-04`: write the failing test first. |
| `V-B-06` | Merged into `V-C-11`: small never cuts validation, error handling, security checks or data safety. |
| `V-C-12` | Merged into `V-P-08`: copy the nearest precedent; a second style for something that has one is a defect. |
| `V-C-16` | Merged into `V-P-08`: one concept has one implementation. |
| `V-C-19` | Merged into `V-C-02`: options that serve one concern live in one named sub-object. |
| `V-P-01` | Deleted. The `AGENTS.md` routing table and the session digest already say to read the rules first. |
| `V-C-15` | Deleted. |
| `V-C-17` | Deleted. |

**Thirteen rules are shorter, with the same ID:** `V-P-07`, `V-P-10`, `V-P-12`, `V-P-13`, `V-W-06`, `V-B-05`, `V-B-08`, `V-B-09`, `V-C-02`, `V-C-06`, `V-C-07`, `V-C-08` and `V-C-09`. The sentences other documents quote are kept: the single-parameter and 5-parameter limit of `V-C-02`, the `isValid` sentence of `V-C-08`, the TSDoc format of `V-C-09`, "a guess until atlas confirms it" in `V-P-07`, and the action classes A to D of `V-W-06`. `V-C-09` also takes the comment rule: a comment states a lasting fact or is public-API TSDoc, never a decision, history, an issue number or a review note.

**Three "Enforced by" notes now tell the truth.** `V-W-06` is HARD for the git writes the `guard-git` hook knows and SOFT for the rest. `V-B-05` and `V-B-09` no longer name a doctor note or a hook that is gone. `V-C-02` and `V-C-08` name their lint rule as available in a project that enables `houseConfigs` of `@venizia/dev-configs`.

**Other places follow.** The `guard-git` question on `git reset --hard` now cites `V-W-06`. The subagent card cites `V-W-06` and `V-C-11` instead of `V-W-04` and `V-B-06`. The default `digest.oftenDropped` list loses `V-W-04` and has eleven IDs. The `plan-a-change`, `build-a-feature`, `fix-a-bug` and `review-a-change` skills cite the surviving IDs.

## Who is affected

- **A project that extends or cites a removed ID in `.agents/rules.md`:** `vulcan doctor` fails the `rule-ids` check, naming the ID, until you change it (table below).
- **A project that sets `digest.oftenDropped` with a removed ID:** nothing fails; the digest drops an ID it cannot find.
- **Every project:** the next `vulcan sync` rewrites the per-rule hashes in `.agents/vulcan.manifest.json` and prints `removed`, `changed` or `added` for each rule. Commit the manifest.

## Migration

| Your `.agents/rules.md` says | Change it to |
|---|---|
| `Extends V-W-04` | `Extends V-W-06` |
| `Extends V-S-01 and V-S-07` | `Extends V-S-01` |
| `Extends V-P-03` | `Extends V-P-02` |
| `Extends V-P-09` | `Extends V-P-11` |
| `Extends V-B-01` | `Extends V-B-04` |
| `Extends V-B-06` | `Extends V-C-11` |
| `Extends V-C-12` or `Extends V-C-16` | `Extends V-P-08` |
| `Extends V-C-19` | `Extends V-C-02` |
| `Extends V-P-01`, `V-C-15` or `V-C-17` | No replacement: drop the `Extends` and keep your rule as a bare ID (`P-01`). |

A `V-` ID that appears in prose, in a bullet or in a later cell is not checked, so it goes stale without failing; search your rules and knowledge pages for the twelve IDs and re-point them by hand. Then run `vulcan sync` and `vulcan doctor`.
