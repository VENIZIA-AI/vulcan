import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildIndexPair,
  generateKeyPair,
  isOnBranch,
  publishGuard,
  publishIndex,
  refCommitOf,
} from '@/prebuilt';
import {
  commitAll,
  git,
  makeSourceRepository,
  makeTempDirectory,
  TEMP_DIRECTORIES,
  writeSourceFile,
} from '../sources/source-repo.helper';
import { startFakeGithub } from './fake-github.helper';
import type { IFakeGithub } from './fake-github.helper';

afterAll(() => {
  for (const directory of TEMP_DIRECTORIES) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const EVENT = join(makeTempDirectory({ prefix: 'atlas-event-' }), 'event.json');

writeFileSync(EVENT, '{"repository":{"default_branch":"main"}}');

const dispatch = (
  changes: Record<string, string | undefined> = {},
): Record<string, string | undefined> => ({
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_EVENT_PATH: EVENT,
  GITHUB_REF: 'refs/heads/develop',
  GITHUB_SHA: 'a'.repeat(40),
  GITHUB_REPOSITORY: 'acme/src',
  GITHUB_TOKEN: 'token',
  ATLAS_INDEX_KEY: 'key',
  ...changes,
});

const SHA = 'b'.repeat(40);

describe('a manual run with a ref: only a tag or a branch whose commit is on develop or the default branch', () => {
  /** What the guard asked git: every name it looked up, and every ancestry it checked. */
  const asked = (opts: {
    env: Record<string, string | undefined>;
    ref: string;
    onDevelop?: boolean;
    known?: boolean;
  }) => {
    const looked: string[] = [];
    const checked: string[] = [];
    const result = publishGuard({
      root: '.',
      env: opts.env,
      keyEnv: 'ATLAS_INDEX_KEY',
      ref: opts.ref,
      commitOf: ({ ref }) => {
        looked.push(ref);

        return opts.known === false ? undefined : SHA;
      },
      onBranch: ({ branch }) => {
        checked.push(branch);

        return opts.onDevelop !== false && branch === 'develop';
      },
    });

    return { result, looked, checked };
  };

  test.each(['v0.4.6', 'kernel-v1.0.0', 'release/1.2', 'develop', 'main'])(
    'the name %s, when its commit is on develop, publishes',
    (ref) => {
      const { result, checked } = asked({ env: dispatch(), ref });

      expect(result).toEqual({ publish: true });
      expect(checked.length).toBeGreaterThan(0);
    },
  );

  test('the default branch itself is allowed: a commit on main, with main the default', () => {
    const result = publishGuard({
      root: '.',
      env: dispatch(),
      keyEnv: 'ATLAS_INDEX_KEY',
      ref: 'main',
      commitOf: () => SHA,
      onBranch: ({ branch }) => branch === 'main',
    });

    expect(result).toEqual({ publish: true });
  });

  test('a tag or branch whose commit is on neither develop nor the default branch is refused, naming why', () => {
    const { result } = asked({ env: dispatch(), ref: 'side-topic', onDevelop: false });

    expect(result.publish).toBe(false);
    expect(result.publish ? '' : result.reason).toContain(
      "'side-topic' is not on the default branch or develop",
    );
  });

  test('a name git does not know is refused: not a tag or a branch of this checkout', () => {
    const { result } = asked({ env: dispatch(), ref: 'v9.9.9', known: false });

    expect(result.publish ? '' : result.reason).toContain('not a tag or a branch of this checkout');
  });

  test.each([
    ['a commit hash', SHA],
    ['a short hash', 'b'.repeat(8)],
    ['an option', '--force'],
    ['a name with a space', 'v0.4.6 --help'],
    ['a command substitution', '$(id)'],
    ['a parent', 'develop~1'],
    ['a range', 'a..b'],
    ['a pull request ref', 'refs/pull/4/head'],
    ['HEAD', 'HEAD'],
    ['a name starting with a dash', '-x'],
    ['a name with a newline', 'v1\nv2'],
  ])('%s is refused before git is asked anything', (_label, ref) => {
    const { result, looked, checked } = asked({ env: dispatch(), ref });

    expect(result.publish).toBe(false);
    expect(looked).toEqual([]);
    expect(checked).toEqual([]);
  });

  test('a ref can only be given to a manual run: a push with one is refused', () => {
    const { result, looked } = asked({
      env: dispatch({ GITHUB_EVENT_NAME: 'push' }),
      ref: 'v0.4.6',
    });

    expect(result.publish ? '' : result.reason).toContain('manual run');
    expect(looked).toEqual([]);
  });

  test('the other refusals still hold with a ref: an empty key, no token, a pull request', () => {
    for (const changes of [
      { ATLAS_INDEX_KEY: '' },
      { GITHUB_TOKEN: undefined },
      { GITHUB_EVENT_NAME: 'pull_request' },
    ]) {
      expect(asked({ env: dispatch(changes), ref: 'v0.4.6' }).result.publish).toBe(false);
    }
  });

  test('an empty ref means no ref: the dispatched ref decides, as for a push', () => {
    const none = publishGuard({ root: '.', env: dispatch(), keyEnv: 'ATLAS_INDEX_KEY', ref: '' });
    const feature = publishGuard({
      root: '.',
      env: dispatch({ GITHUB_REF: 'refs/heads/feat/x' }),
      keyEnv: 'ATLAS_INDEX_KEY',
      ref: '',
    });

    expect(none).toEqual({ publish: true });
    expect(feature.publish).toBe(false);
  });
});

/** A checkout: tag `v1` on the first commit, `develop` ahead of it, a side branch with its own commit. */
const repository = () => {
  const source = makeSourceRepository();

  git({ cwd: source.work, args: ['tag', 'v1'] });
  git({ cwd: source.work, args: ['checkout', '-q', '-b', 'side', 'v1'] });
  writeSourceFile({ work: source.work, path: 'side.txt', text: 'side\n' });
  commitAll({ work: source.work, message: 'chore: a side commit' });
  git({ cwd: source.work, args: ['tag', 'side-tag'] });
  git({ cwd: source.work, args: ['checkout', '-q', 'develop'] });
  writeSourceFile({
    work: source.work,
    path: '.agents/knowledge/overview/later.md',
    text: '---\ntype: Concept\ntitle: Later\ndescription: Later.\n---\n\nA page added after the tag.\n',
  });
  commitAll({ work: source.work, message: 'chore: develop moves on' });
  git({ cwd: source.work, args: ['push', '-q', 'origin', 'develop'] });

  return {
    ...source,
    first: git({ cwd: source.work, args: ['rev-parse', 'v1'] }),
    head: git({ cwd: source.work, args: ['rev-parse', 'HEAD'] }),
    side: git({ cwd: source.work, args: ['rev-parse', 'side-tag'] }),
  };
};

describe('what git says about a ref', () => {
  test('refCommitOf takes a tag or a branch name and nothing else', () => {
    const { work, first, head, side } = repository();

    expect(refCommitOf({ root: work, ref: 'v1' })).toBe(first);
    expect(refCommitOf({ root: work, ref: 'develop' })).toBe(head);
    expect(refCommitOf({ root: work, ref: 'side' })).toBe(side);
    expect(refCommitOf({ root: work, ref: first })).toBeUndefined();
    expect(refCommitOf({ root: work, ref: 'HEAD' })).toBeUndefined();
    expect(refCommitOf({ root: work, ref: 'nope' })).toBeUndefined();
  });

  test('isOnBranch: an ancestor of develop is on it, a side commit is not, and the local branch counts when origin is not fetched', () => {
    const { work, first, head, side } = repository();

    expect(isOnBranch({ root: work, sha: first, branch: 'develop' })).toBe(true);
    expect(isOnBranch({ root: work, sha: head, branch: 'develop' })).toBe(true);
    expect(isOnBranch({ root: work, sha: side, branch: 'develop' })).toBe(false);

    git({ cwd: work, args: ['update-ref', '-d', 'refs/remotes/origin/develop'] });
    expect(isOnBranch({ root: work, sha: first, branch: 'develop' })).toBe(true);
    expect(isOnBranch({ root: work, sha: side, branch: 'develop' })).toBe(false);
  });
});

describe('building the pair of a commit other than HEAD', () => {
  const keys = generateKeyPair();

  test('buildIndexPair with a commit names the pair by that commit and indexes that commit, not HEAD', () => {
    const { work, first, head } = repository();
    const out = join(work, '.agents/local/tmp/pair');
    const built = buildIndexPair({
      root: work,
      out,
      repo: 'acme/src',
      privateKey: keys.privateKey,
      atlasVersion: '1',
      commit: first,
    });

    expect(built.sha).toBe(first);
    expect(readdirSync(out).sort()).toEqual([`${first}.atlas.gz`, `${first}.atlas.json`]);
    expect(first).not.toBe(head);
  });

  test('a commit the repository does not have is refused, and nothing is written', () => {
    const { work } = repository();
    const out = join(work, '.agents/local/tmp/pair');

    expect(() =>
      buildIndexPair({
        root: work,
        out,
        repo: 'acme/src',
        privateKey: keys.privateKey,
        atlasVersion: '1',
        commit: 'c'.repeat(40),
      }),
    ).toThrow('not a commit');
    expect(() => readdirSync(out)).toThrow();
  });
});

describe('publishing the pair of a tag by hand (a manual run with a ref)', () => {
  let fake: IFakeGithub;
  const keys = generateKeyPair();

  beforeEach(() => {
    fake = startFakeGithub({ owner: 'acme', repo: 'src' });
    fake.options.release = false;
  });

  afterEach(async () => {
    await fake.stop();
  });

  const env = (changes: Record<string, string | undefined> = {}) =>
    dispatch({
      GITHUB_API_URL: fake.apiUrl,
      GITHUB_TOKEN: 'test-token-value',
      ATLAS_INDEX_KEY: keys.privateKey,
      ...changes,
    });

  test('the pair is named by the tag commit, not by HEAD, and the release is made at that commit', async () => {
    const { work, first, head } = repository();
    const result = await publishIndex({
      root: work,
      env: env(),
      keyEnv: 'ATLAS_INDEX_KEY',
      atlasVersion: '9.9.9',
      ref: 'v1',
    });

    expect(result).toMatchObject({
      published: true,
      sha: first,
      uploaded: [`${first}.atlas.gz`, `${first}.atlas.json`],
    });
    expect([...fake.assets.keys()].sort()).toEqual([`${first}.atlas.gz`, `${first}.atlas.json`]);
    expect([...fake.assets.keys()].join(' ')).not.toContain(head);
    expect(fake.releasesCreated[0]['target_commitish']).toBe(first);
  });

  test('a ref on no allowed branch is refused before the commit is checked out or anything is asked of GitHub', async () => {
    const { work } = repository();
    const result = await publishIndex({
      root: work,
      env: env(),
      keyEnv: 'ATLAS_INDEX_KEY',
      atlasVersion: '9.9.9',
      ref: 'side-tag',
    });

    expect(result.published).toBe(false);
    expect(result.published ? '' : result.reason).toContain(
      "'side-tag' is not on the default branch or develop",
    );
    expect(fake.requests).toEqual([]);
    expect(git({ cwd: work, args: ['worktree', 'list'] }).split('\n')).toHaveLength(1);
  });

  test.each(['--evil', 'HEAD', 'refs/pull/4/head', 'nope'])(
    'the ref %s is refused with nothing asked of GitHub',
    async (ref) => {
      const { work } = repository();
      const result = await publishIndex({
        root: work,
        env: env(),
        keyEnv: 'ATLAS_INDEX_KEY',
        atlasVersion: '9.9.9',
        ref,
      });

      expect(result.published).toBe(false);
      expect(fake.requests).toEqual([]);
    },
  );

  test('the same ref given to a push is refused', async () => {
    const { work } = repository();
    const result = await publishIndex({
      root: work,
      env: env({ GITHUB_EVENT_NAME: 'push' }),
      keyEnv: 'ATLAS_INDEX_KEY',
      atlasVersion: '9.9.9',
      ref: 'v1',
    });

    expect(result.published).toBe(false);
    expect(fake.requests).toEqual([]);
  });

  test('with no ref a manual run publishes HEAD of the dispatched ref, like a push', async () => {
    const { work, head } = repository();
    const result = await publishIndex({
      root: work,
      env: env(),
      keyEnv: 'ATLAS_INDEX_KEY',
      atlasVersion: '9.9.9',
    });

    expect(result).toMatchObject({ published: true, sha: head });
  });
});
