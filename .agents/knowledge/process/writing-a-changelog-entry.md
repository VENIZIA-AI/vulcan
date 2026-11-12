---
type: Playbook
title: Writing a changelog entry
description: The shape of a wiki changelog entry, the parts every entry needs, and the template to copy.
tags: [process, changelog, docs]
---

# Writing a changelog entry

<!-- okf:generated:contents start -->
**Contents**

- [What goes in the changelog](#what-goes-in-the-changelog)
- [What every entry needs](#what-every-entry-needs)
- [Optional frontmatter](#optional-frontmatter)
- [The migration block](#the-migration-block)
- [Template](#template)
<!-- okf:generated:contents end -->

An entry is a file in `docs/wiki/content/changelogs/` named `YYYY-MM-DD-<slug>.md`. The changelog index
(`/changelogs/`) is built from the entries themselves: add the file and it appears, grouped by year, with
no table to edit. Copy the template below.

## What goes in the changelog

The changelog records only what affects the users of the published packages and what they can use. Each entry
is short and states the user's benefit.

| Write an entry when the change | Write none when the change is |
|---|---|
| adds a feature, a command, an option or a config key | release tooling, CI, workflows, guards and gates |
| changes behaviour, or breaks something (with the upgrade step) | a refactor or a code sweep with no behaviour change |
| fixes a bug a user could hit | tests, agent rules and skills for this repository's own sessions |
| fixes a security problem | internal docs and knowledge pages, repo hygiene |
| deprecates or removes something | |

A pull request that holds only internal work gets no entry, and a stable release with no entry is fine: its
GitHub Release says there is no change for users. When several changes of one release say one thing, write one
entry, not one per change.

## What every entry needs

| Part | Where | Rule |
|---|---|---|
| **Title** | frontmatter `title:` and the heading under `# Changelog - date` | A plain sentence that names what changed, in sentence or title case. No product name, no version and no placeholder: not `VULCAN 0.4.8: ...`, never a literal `X.Y.Z`. The heading repeats the title. `make changelog-check` fails on a literal `X.Y.Z`. |
| **Badge** | one `<Badge>` line under the first heading | Keep the ones that apply: New Feature, Enhancement, Bug Fix, Security, Behavior Change, Breaking Change. The first types the entry on the index and in the filters. |
| **`packages:`** | frontmatter | The npm names whose code changed, from `packages[].name`. An entry that covers no package is internal work and is not written. `okf check --strict` fails an entry without the list. |
| **Upgrade note for a breaking change** | the `## Breaking changes` section | Who is affected, then Before and After code or numbered steps. Delete the section when nothing breaks. |
| **Who is affected** | `## Who is affected` | Each audience, and whether it must act ("No action needed" where true). |

The title and the description (one plain sentence) are the entry's card on the index. An optional
`summary:` (one or two plain sentences) replaces the description there when the card needs better text.

## Optional frontmatter

| Field | Use |
|---|---|
| `summary:` | The card text on the index and the feed; defaults to `description:`. |
| `type: release` | Marks a release overview (the batch page with the upgrade checklist) as its own type. A file name with `batch-overview`, or a title ending "(Overview)", does the same. |
| `release: '<npm name>@<version>'` | Places an entry git would place wrongly (a backfill); it must name a tag that exists. The index shows this version; a title carries none, so without it the entry shows no version. |
| `badges: [...]` | Overrides the `<Badge>` line when the types are wanted without the markup. |

## The migration block

A Breaking Change entry (badge text `Breaking Change`; `Breaking` is read as breaking too but reported on entries after the cutover) dated on or after `knowledge.migrationFrom` carries `migration:` in its frontmatter: how an app moves across the change, in both directions. `vulcan changelog check` (part of `make changelog-check`) fails when it is missing or invalid; entries before the cutover are never read.

```yaml
migration:
  - id: redis-factory-per-topology       # lower-case words joined by -, unique across the folder
    symbols: [RedisHelperFactory.create] # the names an app's code uses: Name, Name.member or a module specifier
    upgrade: { before: "RedisHelper.new()", after: "RedisHelperFactory.create()" }  # or { steps: ["..."] }
    downgrade: { steps: ["Call RedisHelper.new() again"] }   # required; an irreversible change says so here
    data: "Stored tokens keep the old prefix."               # optional: stored data that does not cross the boundary
    codemod: namespace-functions                             # optional: a `devz codemod` name
```

List the symbols as the app spells them before the change (a removed or renamed name is not in the new exports, so the check does not look them up). `before`/`after` and `steps` are alternatives, never both. The `## Breaking changes` section stays: it is the human version of the same steps.

## Template

````markdown
---
title: [A plain sentence - what changed, what a user would search for. No product name, no version]
description: [One sentence, plain - what changed and why it matters]
# Mandatory: the npm names whose code changed in this release.
packages: ['@venizia/vulcan']
---

# Changelog - YYYY-MM-DD

## [The same title as above]

<!-- Keep only the badges that apply -->
<Badge type="tip" text="New Feature" /> <Badge type="tip" text="Enhancement" /> <Badge type="info" text="Bug Fix" /> <Badge type="danger" text="Security" /> <Badge type="warning" text="Breaking Change" />

**In one line.** [One plain sentence: what this release is, for a user.]

## What changed

- **[Thing 1].** [One crisp point in plain language - what changed, not the internal how.]
- **[Thing 2].** [One crisp point in plain language.]
- **[Thing 3].** [One crisp point in plain language.]

<!-- Group with ### sub-heads only if there are many bullets -->

## Who is affected

- **[Audience or situation 1].** [Are they impacted, and do they need to act? Say "No action needed" where true.]
- **[Audience or situation 2].** [Are they impacted, and do they need to act?]

## Breaking changes

<!-- ONLY include this section if there are breaking changes - delete it otherwise -->

> [!WARNING]
> [One sentence: who this affects and why.]

**Before:**

```typescript
// Code that no longer works
```

**After:**

```typescript
// New pattern
```

<!-- Or, for a non-code migration, a short numbered list -->
1. [Step one]
2. [Step two]

````

No `## Details` section: how the change was built, which files moved and how it was tested are not a user's
concern. A caveat the user needs (a feature not yet run in a real agent, say) is one line under `What changed`.

The entry's own first heading (`# Changelog - date`), its title heading and its badge line are replaced on
the page by a title block built from the same fields; write them as the template shows so the page and the
source both read well.
