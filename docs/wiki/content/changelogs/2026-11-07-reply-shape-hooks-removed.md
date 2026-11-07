---
title: The reply-shape hooks are removed
description: VULCAN no longer checks an agent's reply against the owner's report shape and no longer adds a line to each prompt; the session digest still tells the model the shape.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-07

## The `stop`, `prompt-submit` and `post-tool` hooks are removed

<Badge type="warning" text="Breaking" />

**In one line.** VULCAN no longer checks an agent's reply against the owner's report shape, no longer adds a line to each prompt, and no longer keeps notes about each tool call. The session digest still gives the model the shape card "How to answer the owner", so the model still knows the shape; nothing holds it to it.

## What changed

- **No reply check.** The `stop` hook compared the last reply with the shape (headline, minimap, Blocked line, decisions, order, emoji, relative paths) and, under `enforce: block`, sent a wrong reply back once. It is gone, with the log `.agents/local/violations.jsonl` and the per-session notes in `.agents/local/cache/replies/`.
- **No line added to each prompt.** The `prompt-submit` hook added "Owner reply contract: ..." to every prompt. It is gone.
- **No tool-call notes.** The `post-tool` hook wrote one line per tool call to `.agents/local/cache/signals.jsonl`, to say when the agent seemed stuck in a loop, to suggest evals after a skill or rules edit, and to feed the claim check at Stop (a reply that says "published" or "all tests pass" without a probe or with a failed gate). All of it is gone. It had one reader, the `stop` hook.
- **Three processes fewer per turn.** One process per tool call, one per prompt and one per reply no longer start.
- **`vulcan sync` removes the four hook entries** (`Stop`, `UserPromptSubmit`, `PostToolUse`, `PostToolUseFailure`) from `.claude/settings.json` on the next run. A hook of your own on one of these events stays. The agent event log (`events.log: true`) has its own hooks on `Stop` and `PostToolUse`; they are not touched.
- **`vulcan doctor` no longer prints the reply count.** The note about flagged replies read the removed log.
- **What stays.** The `owner` config block, the profile (`vulcan profile`) and the two cards in the session digest. `owner.report.enforce` stays and does one thing: `off` leaves the shape card out of the digest, `advise` and `block` print it, the same. `VULCAN_OWNER_REPLY=off` still leaves both cards out of one session. `VULCAN_GUARDS=off` still switches the guards off.

## Migration

Two keys read only by the removed hooks are now refused, with a pointer, by `vulcan sync` and `vulcan doctor` (the config) and by `vulcan doctor` (the profile).

| Key | Before | After |
|---|---|---|
| `owner.report.claimWords` | `owner: { report: { claimWords: { public: ['publicado'] } } }` | Delete the key. The error reads `removed: delete this key; the reply check that read it is gone` |
| `owner.report.shortReplyWords` | `owner: { report: { shortReplyWords: 0 } }` | Delete the key. Same error |
| `shortReplyWords` in `.agents/local/profile.json` | `{ "schemaVersion": 1, "shortReplyWords": 0 }` | Delete the key, or run `vulcan profile reset --yes` and answer the form again |

`owner.report.enforce: 'block'` still loads and no longer blocks anything; set it to `'advise'` or delete it. The profile's `enforce` is the same.

Two files are left behind and can be deleted: `.agents/local/violations.jsonl` (`vulcan doctor` now names it as an entry VULCAN does not know) and `.agents/local/cache/signals.jsonl` plus the folder `.agents/local/cache/replies/` (`vulcan clean --cache --yes` removes them; `signals.jsonl` is no longer protected).

## Who is affected

- **Every project that uses the shipped hooks:** after `vulcan upgrade` (or a version bump and `vulcan sync`) a reply is not checked and a prompt gets no extra line. Nothing else changes for the model: it still reads the shape card at the start of the session.
- **Projects that set `owner.report.claimWords` or `owner.report.shortReplyWords`, or a profile that sets `shortReplyWords`:** delete the key before you sync.
- **Projects that used `enforce: block` to hold replies to the shape:** nothing holds them now.
