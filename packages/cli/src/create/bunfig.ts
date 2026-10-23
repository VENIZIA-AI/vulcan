/**
 * The root `bunfig.toml` `init` writes: Bun's telemetry off, and the `[fmt]` section `bun fmt` reads -
 * the settings of `oxfmtConfigs` in `@venizia/dev-configs`, so `bun fmt` and oxfmt format alike (the
 * other options are Bun's defaults: tab width 2, trailing commas, semicolons, bracket spacing). No
 * `minimumReleaseAge`: a gate of a few days fails a fresh install whose version floors are the latest
 * releases (measured on a real project: ten packages), so it stays out; Phat's rule is floors at the
 * latest.
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
    '',
  ].join('\n');
