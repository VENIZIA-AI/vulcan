# Testing

How a claim is turned into a test, and how the test is kept honest. It is loaded by `plan-a-change`,
`build-a-feature` (steps 3 and 5), `fix-a-bug` and `review-a-change`.

**Contents**: [Where a test lives](#where-a-test-lives) · [The loop](#the-loop) · [Anti-patterns](#anti-patterns) · [Mocking](#mocking) · [Fixtures and environment](#fixtures-and-environment) · [Blast radius](#blast-radius) · [Async UI and shipped UI](#async-ui-and-shipped-ui) · [When a verifier cannot run](#when-a-verifier-cannot-run) · [Regression tests](#regression-tests) · [Evals for skills and rules](#evals-for-skills-and-rules)

## Where a test lives

At an agreed seam, and only there: a public boundary where a test observes behaviour (an HTTP route, a
service method, a rendered page, a command's output). The project's existing test layout wins over any
layout you would choose. The level follows the claim:

| The claim is about   | The test is                                               |
| -------------------- | --------------------------------------------------------- |
| A pure function      | A unit test, or a property test                           |
| A module's behaviour | A test at its seam                                        |
| A command line tool  | A subprocess test: arguments in, exit code and output out |
| A UI                 | A real browser                                            |
| A skill or a rule    | An eval, with a baseline arm                              |

## The loop

- **Red before green, and say why it is red.** A test that fails for a reason you did not expect proves
  nothing. The failing test names the production break it catches.
- **Run the probes first for a claim that may already hold.** A probe that already passes means the claim
  was already true or the probe cannot fail; find out which.
- **One seam, one test, one minimal implementation.** Then the next.
- **Refactor only with the tests green**, and in review, not in the red-green loop.
- Run the type check often, one test file often, the whole suite once at the end.

## Anti-patterns

- A test coupled to the implementation: it breaks on a refactor that changes no behaviour.
- A tautology: the expected value comes from the same formula as the code. Expected values come from a
  literal, the spec, or a worked example computed by hand.
- Horizontal slicing: all the tests first, then all the code. Work in vertical slices.
- A hand-written state in place of the transition: a test of a state machine edge must produce the edge.
  The check: remove the one line that sets the flag, in a copy of the file under `.agents/local/tmp/` or
  by hand and put it back by hand (never with a git command that discards edits, V-W-01), and run the
  test again; if it is still green, the test is decoration.
- A test that cannot go red.
- Widening or weakening an assertion to make it pass (V-B-04).

## Mocking

Mock at system boundaries only: an external API, the clock, randomness, sometimes the database or the
file system. Inject dependencies instead of reaching for them. Prefer one function per operation to one
generic fetcher: it is easier to fake and easier to read.

## Fixtures and environment

Fixtures are data. A test makes its own temp folder under the project's `.agents/local/tmp/` and removes
it; it runs alone and in any order. The environment is scrubbed: no test depends on a variable of the
machine. Anything a test writes beyond its temp folder (a log, telemetry, state) goes where an environment
variable says, and the test sets that variable to its own temp folder, so test output never lands in real
telemetry. No retries, no sleeps (wait on the condition), no fixed ports (use port 0), and a slow test
is explained, not given a longer timeout. A flaky test is named in a tracking note and fixed; it is
never skipped or retried without the owner's word (V-B-04).

## Blast radius

Lane L, or a surface that holds secrets, auth, publishing or deletion, needs a deterministic probe and a
small diff a person can read line by line. Add a mutation check on the guard that matters: remove the
one line (on a copy, or by hand, and restore it by hand) and run the tests again; a guard whose tests
stay green is not tested. Check that the line is back before you finish.

## Async UI and shipped UI

An asynchronous claim lists its states: loading, error, empty and populated. Shipped UI is checked in a
real browser at mobile width and at desktop width, and the page is looked at, not just fetched.

## When a verifier cannot run

If a verifier is unavailable (no browser, no network, no credentials), the claim is reported as
deferred-verify. It is never described as works, live, verified or shipped.

## Regression tests

A regression test goes in before the fix, at a seam that reproduces the real bug pattern. If no such seam
exists, that is itself a finding: report it, and do not write a test that cannot fail.

## Evals for skills and rules

A suite has should-do cases and should-not cases: an eval that only checks the wanted behaviour optimises
for it blindly. The grader is a different model level from the one under test, gives its reasons before
its verdict, and answers UNKNOWN when it cannot tell (counted as a miss). Always include a baseline arm
(the same case with no skill) so the skill's effect is visible. Read the transcripts before trusting a
score. Changing a rule or a skill is a reason to run its eval again.
