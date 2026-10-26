---
title: 'VULCAN 0.3.7: The Root .dockerignore Keeps .env Files Out of Images'
description: Security fix. The .dockerignore that vulcan init wrote in 0.3.6 did not exclude .env files, so a Docker build that copies the project put app secrets in an image layer; init now excludes them and doctor warns about projects made by 0.3.6.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-21

## VULCAN 0.3.7: the root .dockerignore keeps .env files out of images

<Badge type="danger" text="Security" />

**In one line.** The root `.dockerignore` written by 0.3.6 left `.env` files in the Docker build context; 0.3.7 excludes them, and `vulcan doctor` warns when a project still lets them in.

## What changed

- **What leaked.** `vulcan init` (and `vulcan init --preset`) in 0.3.6 wrote a root `.dockerignore` that excluded dependencies, build output, `.git` and the agents' files, but not `.env`. An app Dockerfile that copies the project (`COPY . .`) then put every app's `.env` (database passwords, tokens) into the builder layer. A CI layer cache such as kaniko can keep that layer.
- **The fix in `init`.** The file now adds `**/.env`, `**/.env.*` and `!**/.env.example`, in that order, under a comment that says why. `.env.example` stays in the context. A plain `vulcan init` writes the same lines.
- **`vulcan doctor` warns.** An app with `.configs/builders/Dockerfile` and a root `.dockerignore` that is missing, or does not exclude `.env` and `.env.*`, gets `warning [dockerignore]` naming the three lines to add. A warning is not a failure: the exit code stays `0` and the last line says `vulcan doctor: OK with 1 warning(s)`. In 0.3.6 the missing-file case was an info note; it is now this warning.
- **Never copy a credential file into an image.** Docs now say it: an `.npmrc` with an auth token, a `.netrc` or a key stays out of the Dockerfile; a private registry is passed through `BUN_CONFIG_REGISTRY`, handed over as a build secret, never as a copied file ([Presets](/references/presets#a-dockerfile-in-a-preset)).

## Who is affected

- **Any project made by 0.3.6 that builds a Docker image.** Its `.dockerignore` lacks the lines. Run `vulcan doctor`; it names the file and the lines. Add `**/.env`, `**/.env.*` and `!**/.env.example` at the end of the root `.dockerignore`, then rebuild the images and rotate any secret that was in a `.env` copied into an image or a CI cache you cannot clear.
- **A project that does not build a Docker image, or wrote its own `.dockerignore`.** No action needed beyond `doctor` telling you if the lines are missing.

## Details

- `doctor` accepts `.env`, `**/.env`, `.env*` and `**/.env*` (and the `.env.*` forms) as excluding; a later `!` line that brings `.env` back counts as not excluding.
- The warning level is new: it prints above the notes, changes no exit code, and only the `dockerignore` check uses it.
