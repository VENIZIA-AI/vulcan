import { describe, expect, test } from 'bun:test';
import { GitProviders, ProviderTypes, ProviderReasons } from '@/provider';
import type { IGitProvider } from '@/provider';

const fake = (opts: { webUrl: string }): IGitProvider => ({
  type: ProviderTypes.GITHUB,
  currentRepository: () => undefined,
  listPullRequests: () => ({ ok: false, reason: ProviderReasons.UNSUPPORTED }),
  webUrl: () => opts.webUrl,
});

describe('GitProviders', () => {
  test('asks for a provider by type, and a second one of the same type replaces the first', () => {
    const first = fake({ webUrl: 'https://one' });
    const second = fake({ webUrl: 'https://two' });

    GitProviders.register({ provider: first });
    expect(GitProviders.of({ type: ProviderTypes.GITHUB })).toBe(first);

    GitProviders.register({ provider: second });
    expect(GitProviders.of({ type: ProviderTypes.GITHUB })).toBe(second);
    expect(GitProviders.types()).toContain(ProviderTypes.GITHUB);
  });
});

describe('the provider constants', () => {
  test('a type and a reason validate by value', () => {
    expect(ProviderTypes.isValid('github')).toBe(true);
    expect(ProviderTypes.isValid('svn')).toBe(false);
    expect(ProviderReasons.isValid('unreachable')).toBe(true);
    expect(ProviderReasons.isValid('nope')).toBe(false);
  });
});
