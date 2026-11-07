import type { IGitProvider, TProviderType } from './common/types';

/** The providers by type: a caller asks for the one that serves its repository and never names a host's tool itself. */
export class GitProviders {
  private static readonly providers = new Map<TProviderType, IGitProvider>();

  /** Registers a provider; a second one of the same type replaces the first (tests use this for a fake). */
  static register(opts: { provider: IGitProvider }): void {
    GitProviders.providers.set(opts.provider.type, opts.provider);
  }

  static of(opts: { type: TProviderType }): IGitProvider | undefined {
    return GitProviders.providers.get(opts.type);
  }

  static types(): TProviderType[] {
    return [...GitProviders.providers.keys()];
  }
}
