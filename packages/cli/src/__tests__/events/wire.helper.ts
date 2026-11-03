const snake = (name: string): string =>
  name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

/** A hook payload as Claude Code sends it: the test writes camelCase keys, the wire form is snake_case, at every depth. */
export const wire = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => wire(item));
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [snake(key), wire(item)]));
  }

  return value;
};
