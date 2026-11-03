---
title: "VULCAN 0.3.7: The Root .dockerignore Keeps .env Files Out of Images"
description: Security fix. The .dockerignore that vulcan init wrote in 0.3.6 did not exclude .env files, so a Docker build that copies the project put app secrets in an image layer; init now excludes them and doctor warns about projects made by 0.3.6.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-21

## VULCAN 0.3.7: The Root .dockerignore Keeps .env Files Out of Images

<Badge type="danger" text="Security" />

**In one line.** The root `.dockerignore` written by 0.3.6 left `.env` files in the Docker build context; 0.3.7 excludes them, and `vulcan doctor` warns when a project still lets them in.

## What changed

- **What leaked.** `vulcan init` in 0.3.6 wrote a root `.dockerignore` that did not exclude `.env`. An app Dockerfile that copies the project (`COPY . .`) then put every app's `.env` (database passwords, tokens) into the builder layer, which a CI layer cache can keep.
- **The fix in `init`.** The file now adds `**/.env`, `**/.env.*` and `!**/.env.example`, in that order. `.env.example` stays in the context.
- **`vulcan doctor` warns.** An app with `.configs/builders/Dockerfile` and a root `.dockerignore` that is missing, or does not exclude `.env` and `.env.*`, gets `warning [dockerignore]` naming the lines to add. A warning is not a failure: the exit code stays `0`.
- **Never copy a credential file into an image.** Keep an `.npmrc` with an auth token, a `.netrc` or a key out of the Dockerfile; pass a private registry as a build secret ([Presets](/references/presets#a-dockerfile-in-a-preset)).

## Who is affected

- **Any project made by 0.3.6 that builds a Docker image.** Run `vulcan doctor`. Add `**/.env`, `**/.env.*` and `!**/.env.example` at the end of the root `.dockerignore`, rebuild the images, and rotate any secret that was in a `.env` copied into an image or a CI cache you cannot clear.
- **A project that does not build a Docker image, or wrote its own `.dockerignore`.** No action needed beyond what `doctor` tells you.
