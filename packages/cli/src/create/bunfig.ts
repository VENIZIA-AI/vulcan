/**
 * The root `bunfig.toml` `init` writes: Bun's telemetry off. No `minimumReleaseAge`: a gate of a few
 * days fails a fresh install whose version floors are the latest releases (measured on a real project: ten
 * packages), so it stays out; Phat's rule is floors at the latest.
 */
export const renderBunfig = (): string =>
  [
    '# Bun reads this file only from the directory a command runs in, so it sits at the root.',
    'telemetry = false',
    '',
  ].join('\n');
