---
title: The board reads its logo only from inside the project and keeps the token out of the browser launch
description: board.logo is read only when it is an .svg file inside the project, and vulcan board serve --open no longer puts the access token in the arguments of the program that opens the browser.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-06

## The board reads its logo only from inside the project and keeps the token out of the browser launch

<Badge type="danger" text="Security" /> <Badge type="info" text="Behavior Change" />

**In one line.** `vulcan board` now reads `board.logo` only when it is an `.svg` file that lies inside the project, and `vulcan board serve --open` hands the browser a short-lived one-time address instead of the address with the access token.

## What changed

- **The logo must be an `.svg` file inside the project.** The manifest value follows the same rule the config already had: it ends in `.svg`, is not absolute and has no `..` segment. The file is then resolved, links included, and must lie inside the project. A logo that fails any of this is left out, as a missing one is, and the note on stderr says so. A link that points to a file inside the project still works. The size cap (100 KB) and the check that the file is an SVG are unchanged.
- **`--open` no longer puts the token in the launch.** The program that opens the browser (`xdg-open`, `open` or `explorer.exe`) is now given `http://<name>:<port>/open/<code>`. The code is random, works once and for 10 seconds, and the server answers it by sending the browser to the board address. The address printed on stdout and the `127.0.0.1` address on stderr still carry the token and work as before.

## Who is affected

- **Projects with `board.logo` set:** a path outside the project, or a link that leads outside it, now shows no logo. Keep the file in the project.
- **Everyone who uses `vulcan board serve --open`:** nothing to do. The board opens as before.
