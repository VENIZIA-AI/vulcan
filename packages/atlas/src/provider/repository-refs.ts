import { ProviderHosts, ProviderTypes } from './common/constants';
import type { IProjectProvider, IRepositoryRef, TProviderType } from './common/types';

/**
 * One reading of a repository name, for every caller that had its own copy of the `owner/repo` pattern.
 * A bare `owner/repo` is always github.com, whatever the project's provider is: presets ship this form, so
 * its meaning must not depend on the project.
 */
export class RepositoryRefs {
  /** `owner/repo`: letters, digits, `.`, `_` and `-` in two parts. */
  private static readonly BARE = /^([\w.-]+)\/([\w.-]+)$/;
  /** `type:path`, for a provider that is not the default (`github:owner/repo`). */
  private static readonly QUALIFIED = /^([a-z]+):([\w.-]+(?:\/[\w.-]+)+)$/;
  /** `https://host/path` and `ssh://git@host/path`. */
  private static readonly URL_FORM =
    /^(?:https?|ssh):\/\/(?:[^@/\s]+@)?([^/:@\s]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/;
  /** `git@host:path`, the form `git clone` prints. */
  private static readonly SCP_FORM = /^[\w.-]+@([^/:@\s]+):(.+?)(?:\.git)?\/?$/;
  private static readonly PATH = /^[\w.-]+(?:\/[\w.-]+)+$/;

  /** `owner/repo` and nothing else: the only form of a source that has a tarball path. */
  static bareOf(opts: { value: string }): { owner: string; repo: string } | undefined {
    const parts = RepositoryRefs.BARE.exec(opts.value);

    return parts === null ? undefined : { owner: parts[1] ?? '', repo: parts[2] ?? '' };
  }

  /** A bare `owner/repo` is a GitHub repository; this is its git URL. */
  static githubUrlOf(opts: { value: string }): string | undefined {
    return RepositoryRefs.bareOf(opts) === undefined
      ? undefined
      : `https://${ProviderHosts.GITHUB}/${opts.value}.git`;
  }

  /**
   * The repository a name, a provider-qualified name or a git URL points at. A host other than github.com is
   * read only when it is the host the project names for its own repository; any other host has no provider,
   * and the answer is `undefined` (its source is reached by git alone).
   */
  static parse(opts: { value: string; provider?: IProjectProvider }): IRepositoryRef | undefined {
    const value = opts.value.trim();
    const bare = RepositoryRefs.bareOf({ value });

    if (bare !== undefined) {
      return RepositoryRefs.build({
        type: ProviderTypes.GITHUB,
        host: ProviderHosts.GITHUB,
        path: value,
      });
    }

    const qualified = RepositoryRefs.QUALIFIED.exec(value);

    if (qualified !== null && ProviderTypes.isValid(qualified[1] ?? '')) {
      const type = qualified[1] as TProviderType;

      return RepositoryRefs.build({
        type,
        host: RepositoryRefs.hostOf({ type, provider: opts.provider }),
        path: qualified[2] ?? '',
      });
    }

    const located = RepositoryRefs.URL_FORM.exec(value) ?? RepositoryRefs.SCP_FORM.exec(value);

    if (located === null) {
      return undefined;
    }

    const host = (located[1] ?? '').toLowerCase();
    const type = RepositoryRefs.typeOf({ host, provider: opts.provider });

    return type === undefined
      ? undefined
      : RepositoryRefs.build({ type, host, path: located[2] ?? '' });
  }

  /** The type that serves a host: github.com is GitHub, the project's own host is its provider, any other host none. */
  static typeOf(opts: { host: string; provider?: IProjectProvider }): TProviderType | undefined {
    const host = opts.host.toLowerCase();

    if (host === ProviderHosts.GITHUB) {
      return ProviderTypes.GITHUB;
    }

    const own = opts.provider;

    return own !== undefined && own.host !== undefined && own.host.toLowerCase() === host
      ? own.type
      : undefined;
  }

  private static hostOf(opts: { type: TProviderType; provider?: IProjectProvider }): string {
    const own = opts.provider;

    return own !== undefined && own.type === opts.type && own.host !== undefined
      ? own.host.toLowerCase()
      : ProviderHosts.GITHUB;
  }

  private static build(opts: IRepositoryRef): IRepositoryRef | undefined {
    const segments = opts.path.split('/');
    // GitHub names a repository `owner/repo`; a deeper path belongs to hosts that nest groups.
    const hasShape = opts.type !== ProviderTypes.GITHUB || segments.length === 2;

    return hasShape &&
      RepositoryRefs.PATH.test(opts.path) &&
      segments.every((segment) => segment !== '.' && segment !== '..')
      ? opts
      : undefined;
  }
}
