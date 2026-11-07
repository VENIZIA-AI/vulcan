import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { GitRepository } from '@/sources/git';
import { SourceResolver } from '@/sources';
import {
  makeSourceRepository,
  makeTempDirectory,
  NO_REGISTRY,
  TEMP_DIRECTORIES,
} from './source-repo.helper';

afterAll(() => {
  for (const directory of TEMP_DIRECTORIES) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const previous = { ...process.env };

afterEach(() => {
  for (const key of [
    'GIT_CONFIG_COUNT',
    'GIT_CONFIG_KEY_0',
    'GIT_CONFIG_VALUE_0',
    'VULCAN_NPM_REGISTRY',
  ]) {
    if (previous[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous[key];
    }
  }
});

const messageOf = (opts: { run: () => unknown }): string => {
  try {
    opts.run();

    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

describe('GitRepository.ALLOWED_PROTOCOLS', () => {
  test('names https, ssh and file, and nothing that is clear text or runs a command', () => {
    expect(GitRepository.ALLOWED_PROTOCOLS).toBe('https:ssh:file');
  });
});

describe('GitRepository.refusedTransportOf', () => {
  test.each([
    ['http://example.test/a.git', 'http://'],
    ['HTTP://example.test/a.git', 'http://'],
    ['  http://example.test/a.git', 'http://'],
    ['git://example.test/a.git', 'git://'],
    ['ext::sh -c "id"', 'remote-helper'],
    ['fd::3', 'remote-helper'],
    ['foo+bar::x', 'remote-helper'],
  ])('%p is refused: %s', (repo, word) => {
    expect(GitRepository.refusedTransportOf({ repo })).toContain(word);
  });

  test.each([
    'owner/repo',
    'https://example.test/a.git',
    'ssh://git@example.test/a.git',
    'git@example.test:owner/repo.git',
    'file:///srv/git/a.git',
    '/srv/git/a.git',
    '../relative/a.git',
    'owner/repo-http',
    'owner/git-http.git',
  ])('%p is left to git', (repo) => {
    expect(GitRepository.refusedTransportOf({ repo })).toBeUndefined();
  });
});

describe('the transports git is given', () => {
  test('git:// and http:// are not allowed, whatever the URL: git refuses them itself', () => {
    for (const url of ['git://127.0.0.1:1/a.git', 'http://127.0.0.1:1/a.git']) {
      expect(
        messageOf({ run: () => GitRepository.run({ args: ['ls-remote', '--', url] }) }),
        url,
      ).toContain('not allowed');
    }
  });

  test('a remote helper does not run, even when the user configured git to allow it', () => {
    const marker = join(makeTempDirectory({ prefix: 'atlas-ext-' }), 'ran');
    // ext:: splits its command at blanks; "% " is a blank inside one word.
    const url = `ext::sh -c touch% ${marker}`;
    const configured = {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'protocol.ext.allow',
      GIT_CONFIG_VALUE_0: 'always',
    };

    // The control: with that configuration and no allow-list, git runs the command.
    spawnSync('git', ['ls-remote', '--', url], {
      env: { ...process.env, ...configured, GIT_TERMINAL_PROMPT: '0' },
      timeout: 15_000,
    });
    expect(existsSync(marker)).toBe(true);
    rmSync(marker);

    Object.assign(process.env, configured);

    expect(GitRepository.lsRemote({ url, ref: 'develop' })).toEqual({ reachable: false });
    expect(
      messageOf({
        run: () =>
          GitRepository.updateClone({
            url,
            gitDir: join(makeTempDirectory({ prefix: 'atlas-ext-' }), 'c.git'),
          }),
      }),
    ).toContain('not allowed');
    expect(existsSync(marker)).toBe(false);
  });

  test('a repository by file:// and by a plain path still clones, and asks for its refs', () => {
    const source = makeSourceRepository();

    for (const url of [source.url, source.bare]) {
      const gitDir = join(makeTempDirectory({ prefix: 'atlas-clone-' }), 'c.git');

      GitRepository.updateClone({ url, gitDir });

      expect(GitRepository.hasClone({ gitDir }), url).toBe(true);
      expect(GitRepository.lsRemote({ url, ref: 'develop' }).reachable, url).toBe(true);
    }
  });
});

describe('a source that names an http:// or git:// URL', () => {
  const resolveSource = (opts: { repo: string }): Promise<unknown> => {
    process.env.VULCAN_NPM_REGISTRY = NO_REGISTRY;

    return SourceResolver.resolve({
      cwd: makeTempDirectory({ prefix: 'atlas-consumer-' }),
      cacheDir: makeTempDirectory({ prefix: 'atlas-cache-' }),
      sources: [{ name: 'src', repo: opts.repo, ref: 'develop' }],
    });
  };

  test.each([
    ['http://127.0.0.1:1/acme/src.git', 'http://'],
    ['git://127.0.0.1:1/acme/src.git', 'git://'],
    ['ext::sh -c "id"', 'remote-helper'],
  ])('%p is refused, naming the source and saying to use https or ssh', async (repo, word) => {
    const failure = await resolveSource({ repo }).then(
      () => '',
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );

    expect(failure).toContain("source 'src'");
    expect(failure).toContain(word);
    expect(failure).toContain('use https or ssh');
  });
});
