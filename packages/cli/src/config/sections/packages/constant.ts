/** The pattern and the length atlas applies to every package name of the manifest. */
export class PackagesSectionConstants {
  /** An npm package name, lower case. */
  static readonly NPM_NAME_PATTERN = /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/;
  static readonly NPM_NAME_MAX_LENGTH = 214;
}
