/** The key a project's flows are named by: `VULZ-<key>-<number>`. Uppercase letters and digits, 2 to 8. */
export class ProjectKey {
  static readonly PATTERN = /^[A-Z0-9]{2,8}$/;
  static readonly MESSAGE = 'uppercase letters and digits, 2 to 8 of them';

  /** The value when it is a key, else `undefined`. */
  static parse(opts: { value: unknown }): string | undefined {
    return typeof opts.value === 'string' && ProjectKey.PATTERN.test(opts.value)
      ? opts.value
      : undefined;
  }

  /** A key from a project name: its letters and digits, uppercase, the first 8; none when fewer than 2 remain. */
  static derive(opts: { name: string }): string | undefined {
    const key = opts.name
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 8);

    return ProjectKey.PATTERN.test(key) ? key : undefined;
  }
}
