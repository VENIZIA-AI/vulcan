---
title: Your own guard targets, temporary files kept in the project, a signed atlas index, a wider vulcan visualize and two wiki link gates
description: Guards ask about the deploy, migrate and push targets you list, sessions keep temporary files in the project, a repository can publish a signed atlas index, vulcan visualize covers more kinds of page, and two wiki link gates ship in vulcan.mk.
packages: ['@venizia/vulcan', '@venizia/vulcan-atlas']
release: '@venizia/vulcan@0.4.6'
---

# Changelog - 2026-10-27

## Your own guard targets, temporary files kept in the project, a signed atlas index, a wider vulcan visualize and two wiki link gates

<Badge type="danger" text="Security" /> <Badge type="tip" text="Enhancement" /> <Badge type="warning" text="Behavior Change" /> <Badge type="tip" text="New Feature" />

**In one line.** Seven changes: your own deploy, migrate and push targets for the guards, temporary files inside the project, better skill selection, a signed atlas index you can publish and download, an atlas rebuild after a format change, new vulcan visualize pages, and two wiki link gates.

## List your own deploy, migrate and push targets for the guards

<Badge type="danger" text="Security" /> <Badge type="tip" text="Enhancement" />

**In one line.** Your deploy and migrate commands and your push branches, such as `make deploy-develop-x`, `bun run migrate:up` and `git push origin develop`, can now make the guards ask.

### What changed

- **`guard.writes.commands`.** A list of `{ rule, what, pattern }`: `rule` is `V-W-02` or `V-W-03`, `what` names the action, `pattern` is a JavaScript regular expression (`ignoreCase: true` for the other spelling). A matching command asks, with the rule and `<what> (this project's pattern)`.
- **`guard.git.askPush`.** Branch names, with `*` for any run of characters. A plain `git push` to one of them asks, including a bare `git push` on that branch and `HEAD:release/1.2`. A force-push or a delete of `develop` or `main` is still denied.
- **Found inside compound commands.** `cd x && make deploy-y`, `bash -c "make deploy-y"`, `sudo make deploy-y` and `echo $(make deploy-y)` match. Text that is data does not: `echo "make deploy-x"`, a commit message.
- **Checked and reported.** A bad pattern, a rule other than `V-W-02` or `V-W-03`, or a branch name with other characters fails the config. `vulcan sync` writes both lists to the manifest, and `vulcan doctor` prints one note per entry.
- **Clearer rule text.** The `V-W-02` and `V-W-03` rows now say the hook asks on the commands it knows plus the project's `guard.writes.commands`; `vulcan sync` reports these base rules as changed once.

### Who is affected

- **Every project.** The new rule wording arrives on the next `vulcan sync`. Nothing else changes unless you list something.
- **A project with its own deploy, migrate or release commands.** List them ([the hooks reference](/references/hooks/#your-own-commands) has the example), run `vulcan sync` and commit the manifest.
- **A project that only uses Claude Code** can add a second layer through Claude Code's own permission rules in the same config (`claude.settings.permissions.ask`). Spell the migrate pattern `Bash(bun run migrate*)`: `Bash(bun run migrate:*)` does not match `bun run migrate:up`.

This is a guard against drift, not a sandbox: a command that builds its name at run time is not seen, and the guards ask rather than deny.

## Temporary files stay in the project, and sessions stop asking about /tmp

<Badge type="tip" text="Enhancement" /> <Badge type="warning" text="Behavior Change" />

**In one line.** `mktemp`, scripts and bun in a Claude Code session use `.agents/local/tmp` of the project instead of `/tmp`, so the permission prompts they caused stop.

### What changed

- **`TMPDIR` points into the project.** The session-start hook exports `TMPDIR=<project>/.agents/local/tmp` before each Bash command in Claude Code, so `mktemp -d` and every script a command starts make their files there.
- **A bare `mktemp` no longer asks** (`mktemp`, `mktemp -d`, `mktemp -t name`). A path chosen by hand (`mktemp /tmp/x.XXXX`, `-p /tmp`, `TMPDIR=/tmp ...`) still asks, as does any other agent.
- **A launch file.** `vulcan sync` writes `.agents/local/claude.launch.settings.json` (gitignored) with `TMPDIR` and `CLAUDE_CODE_TMPDIR`. Start Claude Code with `claude --settings .agents/local/claude.launch.settings.json` and its background-task output and MCP servers use the project folder too.
- **`vulcan doctor`** warns when the launch file is missing or names another checkout; `vulcan sync` fixes it.

### Who is affected

- **Every project that uses Claude Code.** Run `vulcan sync` and restart your sessions. No config change.
- **Without the launch file,** Claude Code's own task-output files stay in `/tmp/claude-<uid>/` and an MCP server uses the system temp folder. An agent other than Claude Code has no such hook; it needs `export TMPDIR=$PWD/.agents/local/tmp` in its launch environment. VULCAN did not check whether those agents can set it from their configuration.

## Agents pick the right skill more often, and a handed-over task names its skill

<Badge type="tip" text="Enhancement" /> <Badge type="warning" text="Behavior Change" />

**In one line.** An agent loads the right skill more often and the wrong one less often, and a task handed to a subagent or another session names the skill to load.

### What changed

#### Skill descriptions

- **Eight new descriptions**: `plan-a-change`, `ship`, `review-a-change`, `docs-writing`, `knowledge-sync`, `retro`, `visualize-work` and `report-back`. Each opens with "Use when", names concrete situations, says what the skill makes, and ends with a short "Skip for" list. `visualize-work` now says it is for showing, presenting, explaining, diagramming or comparing.
- **Four stay as they were**: `build-a-feature`, `docs-update`, `fix-a-bug` and `research`.
- **A 700 character limit** for a shipped skill description (it was 50 words). Your own skills are not affected; `vulcan doctor` still warns only when a description has no "Use when" part.

#### Delegation brief

- **The brief names the skill.** When the work matches a skill (`research`, `review-a-change`, `fix-a-bug`, `plan-a-change` and the rest), the brief now names it and tells the receiver to load it, instead of retyping its steps. The new item is in `base/references/delegation-brief.md`; the later items move down by one.

### Who is affected

- **Every project that syncs VULCAN.** Update `@venizia/vulcan` and run `vulcan sync` to refresh the links and the delegation reference. Restart running sessions: a session keeps the skill descriptions it loaded at the start.
- **Projects that write their own skills.** No action needed. The same shape works: when, what it produces, what to skip.

The descriptions were tested on Sonnet and Haiku only, not on other models or in agents other than Claude Code. A real session's listing was not checked: Claude Code spends about 1% of the context window on skill descriptions and drops those of the least used skills first, whatever their wording. Adding the VULCAN folder to the session (`--add-dir`) shows all twelve.

## A repository can publish a signed atlas index, and atlas downloads it

<Badge type="tip" text="New Feature" />

**In one line.** A repository can publish the search index of each commit, signed, and the projects that read it as a source download it instead of building it.

### What changed

- **Publish an index.** `vulcan x atlas index --out <dir>` writes `<sha>.atlas.gz` (the gzipped index) and `<sha>.atlas.json` (a signed envelope). It is built from the tracked files of HEAD, so an untracked, ignored or edited file never reaches it. A pair built from a shallow checkout is refused.
- **Make a signing key.** `vulcan x atlas index keygen` writes an ed25519 key pair: the private key under `.agents/local/` (mode 0600, only while that folder is gitignored, never over an existing key) and the public key printed.
- **atlas downloads and verifies it.** For a declared GitHub source whose manifest lists public keys (`atlas.index.keys`), atlas fetches the pair of the commit it resolved, checks the signature, the commit, the repository, the format, the digest and the size, and only then installs it. A private repository works with the token atlas already uses (`GITHUB_TOKEN`, else `gh auth token`); a classic token with the `repo` scope was checked, a fine-grained one was not.
- **Any failure builds locally.** A missing pair, a bad signature, another format or a failed request prints one line with its reason, and atlas builds the index as before. `--no-prebuilt` or `atlas.prebuilt: false` turns the download off.
- **The start notice names it.** `<name>: <origin> at <sha> - index: prebuilt, built by atlas <version>`.

### Who is affected

- **Every project.** No action needed: a source with no keys in its manifest is built locally as before.
- **A repository that wants to publish its index.** Make a key pair, store the private key as an Actions secret, list the public key in `atlas.index.keys`, and add the `atlas-index` action (`VENIZIA-AI/vulcan/.github/actions/atlas-index`), which attaches the signed pair of each commit to the release `atlas-index`, where atlas looks for it: [the guide](/guides/core-concepts/atlas#publish-your-index-so-the-projects-that-read-yours-do-not-build-it).

## Atlas rebuilds a cached index of an older format

<Badge type="tip" text="Enhancement" /> <Badge type="warning" text="Behavior Change" />

**In one line.** After an atlas upgrade that changes what an index holds, atlas builds your sources' indexes again, so you never search a stale one.

### What changed

- **A format number per cached index.** atlas writes a `format` file beside each cached index, holding the number of the atlas that built it.
- **A different format means one rebuild.** On the first start after such an upgrade, atlas builds the index of each declared source again, once. Before, it kept serving the old index for a commit it had already cached.
- **Offline, nothing breaks.** When the remote cannot be reached, atlas serves the newest cache whatever its format, and the start notice says it is of another format.

### Who is affected

- **Projects that declare sources.** The first start after updating builds each index again, once. No action needed. A cache from before this release has no `format` file and counts as older.
- **Projects with no sources.** No change.

## Vulcan visualize pages cover every kind of explanation

<Badge type="tip" text="Enhancement" /> <Badge type="tip" text="New Feature" />

**In one line.** `vulcan visualize` now makes a page for anything worth showing, in a look that reads top down, fits a phone and can be presented as slides.

### What changed

- **A new look.** A banner coloured by the state, key numbers as tiles, the minimap as a stepper, and **What you need to do** as a numbered checklist beside **Blocked by**. Light and dark, with a sticky bar that keeps the verdict in view.
- **New kinds**, each an optional section of the spec: `comparison`, `ideaMap`, `explainer`, `architecture`, `timeline` and roadmap items, `findings` (key numbers and bar, line and donut charts) and `decisionRecord`. `minimap`, `tiles`, `actions` and a box `state` are new fields for status pages.
- **A slide mode.** **Present** (or `?present=1`) shows one section at a time with arrow keys, Space, Home, End and Escape, and buttons on a phone.
- **It fits a phone.** Tables stack one block per row, and no page scrolls sideways at 390 px.
- **One word changed.** The default for `strip.next` is now "What you need to do" (it was "What needs action"); a spec that sets `chrome.next` keeps its own word.

### Who is affected

- **Anyone who makes a page with the `visualize-work` skill.** Update `@venizia/vulcan` and run `vulcan sync` to get the updated skill and spec reference. Existing specs render as before; every new field is optional.

## Two wiki link gates ship in vulcan.mk

<Badge type="tip" text="New Feature" />

**In one line.** A VitePress wiki can now check, before it ships, that every source file it names exists on GitHub and every link to a heading lands on a heading.

### What changed

- **`make wiki-links-check`** reads every `.md` file under `docs/wiki/content` and `.agents/knowledge`. A GitHub link into your repository, a backticked path under `packages/`, `examples/`, `scripts/`, `docs/` or `.agents/`, and a concept's `resource:` must each be tracked by git; a gitignored file does not count. Set `WIKI_REPO` (`owner/name`) in your Makefile before the `vulcan.mk` include, or the gate refuses to run.
- **`make wiki-anchors-check`** reads the built site (run `make docs` first) and fails on a link to a heading, or to a page, that does not exist. It judges headings by the ids VitePress emitted.
- **Flags.** `WIKI_LINKS_FLAGS` takes `--dirs`, `--skip-prose` and `--skip`; `WIKI_ANCHORS_FLAGS` takes `--content` and `--dist`.
- **Not checked.** The gates in a project that installs the package from npm; the pack smokes install the tarball but do not run the gates.

### Who is affected

- **A project with a VitePress wiki.** Optional: add `WIKI_REPO := <owner>/<name>` before the include and run the two targets. Nothing changes until you call them.
- **A project that already has a target named `wiki-links-check` or `wiki-anchors-check`.** `vulcan doctor` names the clash; rename yours or move to the shipped one.
