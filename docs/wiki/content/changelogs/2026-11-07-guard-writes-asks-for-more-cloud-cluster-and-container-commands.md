---
title: guard-writes asks for more cloud, cluster and container commands
description: The guard-writes hook asks for aws, gcloud, gsutil, az, kubectl and docker commands that change or run something and passed without a question.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-07

## guard-writes asks for more cloud, cluster and container commands

<Badge type="warning" text="Security" />

**In one line.** The `guard-writes` hook asks for more commands that change a cloud account, a cluster or a registry. Update `@venizia/vulcan`.

## What changed

- **aws.** `lambda invoke`, `sns publish`, `sqs send-message`, `send-message-batch` and `purge-queue`, `ec2 authorize-security-group-ingress` and `-egress`, `iam add-user-to-group`, `ssm send-command`. `iam attach-*-policy` and `ssm start-session` already asked through the verb prefixes the hook knows.
- **gcloud.** `compute instances stop` and `start`, `sql instances patch`, any `add-iam-policy-binding`, `storage rm`. `compute instances delete` and `sql instances delete` already asked.
- **gsutil.** `rm`, `cp`, `mv` and `rsync`.
- **az.** `vm stop`, `start`, `deallocate` and `restart`.
- **kubectl and oc.** `cp`, `debug`, `autoscale` and `exec`. `exec` runs a command in a pod.
- **docker.** `push` and `image push`.
- **Reads stay silent.** `aws lambda list-functions` and `get-function`, `sns list-topics`, `sqs receive-message`, `ec2 describe-*`, `iam list-*` and `get-*`, `ssm describe-*`, `gcloud compute instances list` and `describe`, `sql instances list` and `describe`, `storage ls` and `cat`, `gsutil ls`, `cat` and `du`, `az vm list` and `show`, `kubectl get`, `logs`, `describe` and `top`, and `docker ps`, `images`, `pull`, `build` and `logs`. A call with `--help` or a dry run (`aws ... --dry-run`) passes too.

## Who is affected

- **Every project that installs the VULCAN hooks:** update `@venizia/vulcan`. A command in one of the forms above asks once.
