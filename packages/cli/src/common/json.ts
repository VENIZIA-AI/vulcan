/** The value under `key` of anything that is an object, else undefined: untrusted JSON is read without a cast. */
export const readProperty = (opts: { value: unknown; key: string }): unknown =>
  typeof opts.value === 'object' && opts.value !== null
    ? Reflect.get(opts.value, opts.key)
    : undefined;
