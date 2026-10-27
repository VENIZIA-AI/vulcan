# Documents agents read

A skill description, a rules file, `AGENTS.md`, a reference an agent loads: these are written for a
reader that pays for every word it loads and that obeys what it reads. The method is the same as for
people - one reader, one purpose, plain words - with the changes below.

**Contents**: [Pointers, not essays](#pointers-not-essays) · [Say what changes behaviour](#say-what-changes-behaviour) · [Positive before negative](#positive-before-negative) · [One home for each fact](#one-home-for-each-fact) · [Honest headers](#honest-headers) · [Checks before you finish](#checks-before-you-finish)

## Pointers, not essays

A description or an `AGENTS.md` line is a context pointer: it is loaded on every turn whether or not it
is used, so it carries only what decides whether to load the rest.

- Front-load the word that decides: the verb the reader would search for.
- Name the situations that should load it, a handful at most; a long list is a list nobody reads.
- Cut identity the body already carries: the description does not repeat what the first heading says.
- Use progressive disclosure: the steps in the file, the detail one pointer away, loaded when the pointer
  fires. A reference is linked from the file that needs it, one level deep.
- Every step ends on a completion criterion that is both checkable and exhaustive: "done when each layer
  has a quoted atlas hit", not "done when you understand it".

## Say what changes behaviour

For each sentence ask: does it change what a capable agent does, compared with what it would do anyway?
A sentence that does not is a no-op: cut it. Hunt them one sentence at a time, and again after an edit.
The test of a rule is the model that is better next year: if a smarter model makes the line unnecessary,
the line is a candidate to go.

## Positive before negative

A prohibition drags the forbidden behaviour into context. Say what to do and keep a ban only as a hard
guardrail, paired with its positive target: "write scratch under `.agents/local/`", then "nothing goes in
the system temp directory". A rule broken by a lapse on a line that is already loaded does not need a new
line; it needs a check or an eval.

## One home for each fact

State a fact once and point at it. The environment is a source of truth too: do not restate a script that
`package.json` already lists, or a command the CLI prints with `--help`. Two copies drift, and an agent
cannot tell which one is current.

## Honest headers

A header must not describe behaviour that is not there: a file that says "run by the pre-commit hook"
when no hook runs it misleads for as long as it lives. A gotcha is recorded with where it came from (a
dated incident, a failing test, a reproduction); one with no provenance is methodology, and is cut.

## Checks before you finish

- Descriptions: under 700 characters, a "Use when" part with the concrete moments, what the skill produces, and a short "Skip for" list that names the near neighbours.
- `SKILL.md` under 500 lines; any file past 100 lines opens with a contents list.
- Every rule or skill you changed has its eval (or its check) run again.
- Read it once as the agent that loads it with nothing else: can it act, and does it know when it is done?
