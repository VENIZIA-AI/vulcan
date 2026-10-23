/**
 * The root `bunfig.toml` `init` writes: Bun's telemetry off, and the `[fmt]` section `bun fmt` reads.
 * The three options are the settings of the shared style (`@venizia/dev-configs`, formerly
 * `oxfmtConfigs`); the rest is Bun's defaults (tab width 2, trailing commas, semicolons, bracket
 * spacing). `flavor = "oxfmt"` pins the oxfmt output: without it `bun fmt` formats like Prettier
 * whenever oxfmt is not a dependency (a union type's first member moves to its own line, for one).
 * No `minimumReleaseAge`: a gate of a few days fails a fresh install whose version floors are the
 * latest releases (measured on a real project: ten packages), so it stays out; Phat's rule is floors
 * at the latest.
 */
export const renderBunfig = (): string =>
  [
    '# Bun reads this file only from the directory a command runs in, so it sits at the root.',
    'telemetry = false',
    '',
    '[fmt]',
    'printWidth = 100',
    'singleQuote = true',
    'arrowParens = "avoid"',
    'flavor = "oxfmt"',
    '',
  ].join('\n');
