/**
 * Reading what GitHub sends. A reply is `unknown` until narrowed here, and a snake_case wire name is
 * read through a string-literal key at the call site (V-C-14), never typed as a property of ours.
 */
export const recordOf = (opts: { value: unknown }): Record<string, unknown> =>
  typeof opts.value === 'object' && opts.value !== null && !Array.isArray(opts.value)
    ? Object.fromEntries(Object.entries(opts.value))
    : {};

export const itemsOf = (opts: { value: unknown }): unknown[] =>
  Array.isArray(opts.value) ? opts.value : [];

export const stringOf = (opts: { value: unknown }): string | undefined =>
  typeof opts.value === 'string' ? opts.value : undefined;

export const numberOf = (opts: { value: unknown }): number | undefined =>
  typeof opts.value === 'number' ? opts.value : undefined;
