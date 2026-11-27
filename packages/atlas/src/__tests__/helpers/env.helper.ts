/**
 * Puts an environment variable back as a test found it. Assigning `undefined` would store the string
 * "undefined" - a cache directory named that once appeared beside the package - so an unset variable
 * is deleted, never assigned.
 */
export const restoreVariable = (opts: { name: string; value: string | undefined }): void => {
  if (opts.value === undefined) {
    delete process.env[opts.name];
  } else {
    process.env[opts.name] = opts.value;
  }
};
