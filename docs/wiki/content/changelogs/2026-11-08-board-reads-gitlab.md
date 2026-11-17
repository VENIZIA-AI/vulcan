---
title: vulcan board reads GitLab
description: A new provider key makes vulcan board read merge requests, approvals, pipelines and commits from GitLab through glab, the way it reads pull requests from GitHub through gh.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-08

## `vulcan board` reads GitLab

<Badge type="tip" text="New Feature" />

**In one line.** Set `provider: { type: 'gitlab' }` and `vulcan board` adds the merge requests, approvals, finished jobs and commits of your GitLab project to the board, through `glab`.

## What changed

- **A new config key, `provider`.** `provider: { type: 'github' | 'gitlab', host? }`, default `{ type: 'github' }`. `host` is only for `gitlab`, defaults to `gitlab.com`, and must be a bare host name with an optional port (`git.example.com`, `git.example.com:8443`). A scheme, a path, credentials or a space is refused, and so is `host` with `github`. `vulcan sync` writes the block to the manifest only for `gitlab`, and the board reads it from there.
- **What the board shows from GitLab.** Each merge request (opened, merged, closed without merge), each approval, each finished job of a pipeline (pass or fail; a pipeline with no readable job is one line), and each commit of the default branch. A merge request and its pipelines join the flow named by `Flow: <id>` in its description, or by a flow id in its branch name; a commit joins the flow named by a `Flow: <id>` line in its message. A pipeline on another branch, such as the default branch, belongs to no flow.
- **How it reads.** Only through `glab api` with GET requests, at most 30 merge requests, 30 pipelines and 30 commits, and the jobs of the 10 newest finished pipelines. `glab` keeps the sign-in; VULCAN stores no token. When `glab` is missing, not logged in, or the folder is not a GitLab project it can read, GitLab is skipped with a note on stderr and the board is built from the event log alone.
- **Which project.** `--repo group/sub/name` names a project of any depth (repeat it for several). With none, the project of `git remote get-url origin` is used, only when its host name is the configured `provider.host`.
- **Same flag.** `--no-github` leaves out the host the project uses, GitLab included; the note then says `gitlab: left out (--no-github)`.
- **On the page.** GitLab lines carry the tag `GitLab`, a merge request link opens the merge request, and the people who author commits or merge requests are not shown as agents, as with GitHub.

## Migration

None. A project without `provider` reads GitHub as before. To read GitLab:

| Before | After |
|---|---|
| nothing set | `provider: { type: 'gitlab', host: 'git.example.com' }` in `.configs/vulcan.config.mts`, then `vulcan sync` and `glab auth login --hostname git.example.com` |

## Who is affected

- **Projects on GitLab that use the board:** set `provider` to see merge requests, pipelines and commits. Without it nothing changes.
- **Projects on GitHub:** nothing changes. `--repo` now accepts a longer path than `owner/name` (it is passed to `gh` as given, as before).
