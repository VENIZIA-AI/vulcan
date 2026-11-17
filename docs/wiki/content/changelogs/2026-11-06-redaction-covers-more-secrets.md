---
title: The redaction recognises more forms of a credential and is bounded in time
description: vulcan doctor and the event-log redaction catch more ways a credential is written, and read a long line in time in proportion to its length.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-06

## The redaction recognises more forms of a credential and is bounded in time

<Badge type="danger" text="Security" />

**In one line.** The redaction of event text and the private-values check in `vulcan doctor` recognise more forms of a credential, and the time they take grows in step with the length of the text.

## What changed

- **More forms of a credential are caught.** A password on a command line (the value of a secret-named flag given with a space, the password of curl's user flag, the password flags of the MySQL and MariaDB clients, sshpass, redis-cli, sqlcmd and a docker, podman or az login, the secret `aws configure set` writes), the value of an `Authorization` header of any scheme, the values of a cookie header, a password in a URL that holds `/`, `@` or `:` or has no user, the key of a DSN, the path of a Slack webhook, a 40-character AWS secret key set to an AWS or secret name, the signature of a shared access URL, Hugging Face, DigitalOcean, Shopify and SendGrid tokens, and names such as `pw`, `pass` and `passphrase`.
- **Ordinary text is left alone.** `-p` of any other program, the MySQL `-p` that asks for the password, a value that is a variable or a placeholder, a path or a file name after `--key`, a switch value such as `true` or `1`, a port before an `@` in a URL path, and the words "password" and "token" in a sentence are not redacted.
- **The time is bounded.** Every pattern reads a long line in time in proportion to its length, and an event text is cut to a few times its kept length before it is read. A secret across the cut is still redacted whole, and a word the read cuts through is not shown in part. The reader applies the same bound to the lines it reads back.
- **The gate commands kept for the session nudges are redacted.** The short name of each gate a command ran is redacted before it is stored in the local cache.
- **The board page holds no redaction pattern.** It is built without them, so a browser that cannot read their syntax still opens it.
- **The same list drives both.** The private-values check and the redaction read one list, so both change together.

## Who is affected

- **Everyone using the event log or `vulcan doctor`:** nothing to do. A tracked file that holds one of the new forms gets a `private-values` warning it did not get before.
