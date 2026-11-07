import { describe, expect, test } from 'bun:test';
import { ProviderTypes, RepositoryRefs } from '@/provider';

const GITHUB = { type: ProviderTypes.GITHUB, host: 'github.com' } as const;

describe('RepositoryRefs.bareOf', () => {
  test('reads owner/repo and nothing else', () => {
    expect(RepositoryRefs.bareOf({ value: 'VENIZIA-AI/vulcan' })).toEqual({
      owner: 'VENIZIA-AI',
      repo: 'vulcan',
    });
    expect(RepositoryRefs.bareOf({ value: 'a.b_c/d-e.f' })).toEqual({
      owner: 'a.b_c',
      repo: 'd-e.f',
    });
  });

  test('refuses every other form', () => {
    for (const value of [
      '',
      'owner',
      'owner/',
      '/repo',
      'a/b/c',
      'a b/c',
      'a/b ',
      'https://github.com/a/b',
      'git@github.com:a/b.git',
      'file:///tmp/x',
      'github:a/b',
      'a/b\n',
    ]) {
      expect(RepositoryRefs.bareOf({ value }), JSON.stringify(value)).toBeUndefined();
    }
  });
});

describe('RepositoryRefs.githubUrlOf', () => {
  test('a bare owner/repo is the https git URL on github.com', () => {
    expect(RepositoryRefs.githubUrlOf({ value: 'a/b' })).toBe('https://github.com/a/b.git');
  });

  test('anything else has none: it is a URL already', () => {
    expect(RepositoryRefs.githubUrlOf({ value: 'https://github.com/a/b.git' })).toBeUndefined();
    expect(RepositoryRefs.githubUrlOf({ value: 'file:///tmp/x' })).toBeUndefined();
  });
});

describe('RepositoryRefs.parse', () => {
  test('a bare owner/repo is github.com, whatever the project provider is', () => {
    expect(RepositoryRefs.parse({ value: 'a/b' })).toEqual({ ...GITHUB, path: 'a/b' });
    expect(
      RepositoryRefs.parse({
        value: 'a/b',
        provider: { type: ProviderTypes.GITHUB, host: 'ghe.example.com' },
      }),
    ).toEqual({ ...GITHUB, path: 'a/b' });
  });

  test('every URL form of a github.com repository', () => {
    for (const value of [
      'https://github.com/a/b',
      'https://github.com/a/b.git',
      'https://github.com/a/b/',
      'http://github.com/a/b.git',
      'https://user@github.com/a/b.git',
      'https://github.com:443/a/b.git',
      'ssh://git@github.com/a/b.git',
      'git@github.com:a/b.git',
      'git@github.com:a/b',
      'https://GitHub.com/a/b.git',
      'github:a/b',
    ]) {
      expect(RepositoryRefs.parse({ value }), value).toEqual({ ...GITHUB, path: 'a/b' });
    }
  });

  test('a GitHub path has two parts: a deeper one is not a repository there', () => {
    expect(RepositoryRefs.parse({ value: 'https://github.com/a/b/c' })).toBeUndefined();
    expect(RepositoryRefs.parse({ value: 'github:a/b/c' })).toBeUndefined();
  });

  test('a host no provider knows has no repository, unless it is the project host', () => {
    expect(RepositoryRefs.parse({ value: 'https://example.com/a/b.git' })).toBeUndefined();
    expect(RepositoryRefs.parse({ value: 'git@example.com:a/b.git' })).toBeUndefined();
    expect(
      RepositoryRefs.parse({
        value: 'https://code.example.com/a/b.git',
        provider: { type: ProviderTypes.GITHUB, host: 'code.example.com' },
      }),
    ).toEqual({ type: ProviderTypes.GITHUB, host: 'code.example.com', path: 'a/b' });
  });

  test('a local path, an unknown type and a path that climbs are refused', () => {
    for (const value of [
      '',
      'file:///tmp/x',
      '/tmp/x',
      './a/b',
      '../a/b',
      'unknown:a/b',
      'https://github.com/a/..',
      'https://github.com/../b',
      'https://github.com/a/b c',
      'https://github.com//b',
    ]) {
      expect(RepositoryRefs.parse({ value }), JSON.stringify(value)).toBeUndefined();
    }
  });

  test('a long input is read in time in step with its length', () => {
    const started = performance.now();

    expect(
      RepositoryRefs.parse({ value: `https://github.com/${'a/'.repeat(40_000)}` }),
    ).toBeUndefined();
    expect(
      RepositoryRefs.parse({ value: `git@github.com:${'a'.repeat(200_000)}` }),
    ).toBeUndefined();
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe('RepositoryRefs.typeOf', () => {
  test('github.com is GitHub, the project host is its provider, any other host none', () => {
    expect(RepositoryRefs.typeOf({ host: 'github.com' })).toBe(ProviderTypes.GITHUB);
    expect(RepositoryRefs.typeOf({ host: 'GITHUB.COM' })).toBe(ProviderTypes.GITHUB);
    expect(RepositoryRefs.typeOf({ host: 'example.com' })).toBeUndefined();
    expect(
      RepositoryRefs.typeOf({
        host: 'Code.Example.com',
        provider: { type: ProviderTypes.GITHUB, host: 'code.example.com' },
      }),
    ).toBe(ProviderTypes.GITHUB);
  });
});
