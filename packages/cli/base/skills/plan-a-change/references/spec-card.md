# The spec card

The card is the agreement between the owner and the agent. It is small text, and a section that is empty
is left out. Lane S uses three lines. Lane M uses Goal, Out of scope, Claims (each with its probe) and Docs impact, in chat or the pull request description. Lane L uses all of them, in a file.

**Contents**: [Sections](#sections) · [Rules of the card](#rules-of-the-card) · [Probes](#probes) · [Evidence by claim type](#evidence-by-claim-type)

## Sections

In this order:

| Section | Content |
|---|---|
| Goal | The owner's words, verbatim. It changes only through a dated Decisions line |
| Out of scope | What is not built, in prose |
| Claims | `C1..Cn`: one observable behaviour each, and for each the probe that would show it false. Behaviour is phrased WHEN ... THEN ... |
| Anti-claims | What must not happen, in the universal form where you can ("no X in any path"). Lane L has at least one |
| Seams | The public boundaries tests attach to. An existing seam is preferred; the ideal count is one |
| Docs impact | The pages, knowledge concepts and changelog entry that change, or `none` with the reason |
| Open | Questions too dim to be claims, each naming who resolves it. Empty before work starts |
| Decisions | Dated, append-only. Dead ends and rejected alternatives stay. A `refined:` prefix marks a change of goal or claim |

## Rules of the card

- IDs never renumber. A split claim becomes `C3.1`, `C3.2`; a dropped claim leaves a tombstone.
- A claim with no nameable probe goes to Open.
- If you can edit the Goal without changing any claim, the claims are not tied to it.
- Split a claim while it joins two checkable things with "and" or "or", while one part can pass as another
  fails, or while it says "all" or "every" without listing.
- The card carries no changelog: git is the change record. When a claim closes, its evidence shrinks to a
  one-line stub (the commit, the test name or the command).
- Fog goes to Open, never into a claim. Docs impact unknown is itself an Open question.

## Probes

The probe is on the claim's line. The vocabulary is closed, so the probe says how it is checked:

| Probe | Means |
|---|---|
| `test` | A test file, or a `-t` pattern, run at the agreed seam |
| `property` | A property test for a pure function |
| `cli` | A command, with its exit code and output |
| `http` | `curl -i` against the running route |
| `browser` | A real browser view, at 390 px and at desktop width |
| `eval` | A skill or rule eval, reported as the cases passed over the cases run, with the baseline arm beside it |
| `gate` | `vulcan doctor`, lint, `okf check` or the project's own gate |
| `read` | A read-back of a file or a configuration |
| `manual` | Attested by the owner, dated; never enough alone for secrets, auth, money, publishing or deletion |

An unavailable verifier is reported as deferred-verify, never as passed.

## Evidence by claim type

| Claim about | Evidence |
|---|---|
| A file | Read it |
| Code | Grep, or atlas `symbol` |
| A command | Its checked output, from this session |
| An HTTP route | `curl -i` |
| A publish, release or deploy | A probe of public state: `npm view`, `gh`, `git ls-remote`, the tarball answering 200 |
| A UI | A real browser; appearance is shown in pixels |
| A configuration | A read-back |
| Behavioural quality | An eval: cases passed over cases run, with a baseline arm |

"Should work" is never evidence.
