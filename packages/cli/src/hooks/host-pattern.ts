/**
 * What a remote host entry may be, for the project config (`remoteHosts.trusted`, `readOnly`) and for the
 * personal list the guard reads at run time. It has no import, because the guard loads no config loader and no zod.
 */
export class HostPatterns {
  /** A `$VAR` or `${VAR}`, or a host name made of letters, digits, `.`, `_`, `-` and `*`: never a user, a path or a port. */
  static readonly SHAPE = /^(?:\$\{?\w+\}?|[A-Za-z0-9._*-]+)$/;

  /** A pattern needs a character beyond `*` and `.`: a lone `*` would match every host. */
  static hasLiteral(opts: { value: string }): boolean {
    return opts.value.replaceAll('*', '').replaceAll('.', '') !== '';
  }

  static isValid(opts: { value: string }): boolean {
    return HostPatterns.SHAPE.test(opts.value) && HostPatterns.hasLiteral(opts);
  }
}
