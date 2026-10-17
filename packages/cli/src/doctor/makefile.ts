const RULE_TARGET = /^([A-Za-z0-9][A-Za-z0-9_.-]*)\s*:(?!=)/;

/** Explicit rule targets: `name:` at column 0 - no recipes, assignments, specials or `$(...)` rules. */
export const parseMakeTargets = (opts: { makefile: string }): string[] =>
  opts.makefile
    .split('\n')
    .map(line => RULE_TARGET.exec(line)?.[1])
    .filter((target): target is string => target !== undefined);
