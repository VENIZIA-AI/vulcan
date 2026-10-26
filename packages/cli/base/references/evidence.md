# Evidence by claim type

A claim is shown by a probe run in this session, of the kind that suits what the claim is about. "Should
work" is never evidence. An unavailable verifier is reported as deferred-verify, never as works, live,
verified or shipped.

| The claim is about                    | The evidence                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| A file                                | Read it                                                                               |
| Code                                  | Grep, or atlas `symbol`                                                               |
| A command                             | Its output, checked, from this session                                                |
| An HTTP route                         | `curl -i` against the running route                                                   |
| A publish, a release or a deploy      | A probe of public state: `npm view`, `gh`, `git ls-remote`, the tarball answering 200 |
| A UI                                  | A real browser; how it looks is shown in pixels, at mobile width and at desktop width |
| A configuration                       | A read-back of the file or setting                                                    |
| Behavioural quality (a skill, a rule) | An eval: cases passed over cases run, with a baseline arm beside it                   |

Words that describe a local state - staged, local, candidate - need no public-state probe. Words that
describe a public state - published, released, live, deployed - always do.

The probe kinds a card names on a claim's line, and what each means:

| Probe      | Means                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------- |
| `test`     | A test file, or a `-t` pattern, run at the agreed seam                                            |
| `property` | A property test for a pure function                                                               |
| `cli`      | A command, with its exit code and output                                                          |
| `http`     | `curl -i`                                                                                         |
| `browser`  | A real browser view, at mobile and desktop width                                                  |
| `eval`     | A skill or rule eval                                                                              |
| `gate`     | `vulcan doctor`, lint, `okf check` or the project's own gate                                      |
| `read`     | A read-back of a file or a configuration                                                          |
| `manual`   | Attested by the owner, dated; never enough alone for secrets, auth, money, publishing or deletion |

A probe's strictness scales with the blast radius: secrets, auth, money, a public push or production
need a deterministic probe, never `manual`.
