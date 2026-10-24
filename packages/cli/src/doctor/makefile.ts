const RULE_TARGET = /^([A-Za-z0-9][A-Za-z0-9_.-]*)\s*:(?!=)/;

/** Explicit rule targets: `name:` at column 0 - no recipes, assignments, specials or `$(...)` rules. */
export const parseMakeTargets = (opts: { makefile: string }): string[] =>
  opts.makefile
    .split('\n')
    .map((line) => RULE_TARGET.exec(line)?.[1])
    .filter((target): target is string => target !== undefined);

const INCLUDE_LINE = /^\s*(?:-include|sinclude|include)\s+(.+?)\s*$/;

/** The paths and globs an `include`, `-include` or `sinclude` line names; one built from a variable is skipped. */
export const parseMakeIncludes = (opts: { makefile: string }): string[] =>
  opts.makefile
    .split('\n')
    .flatMap((line) => INCLUDE_LINE.exec(line)?.[1].split(/\s+/) ?? [])
    .filter((path) => !path.includes('$('));
