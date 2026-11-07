import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { chmodSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AtlasGit } from '@/common/constants';
import { GitState } from '@/graph/git-state';
import { GitRepository } from '@/sources/git';
import { GithubTarball } from '@/sources/tarball';
import { makeTempDirectory, TEMP_DIRECTORIES } from './source-repo.helper';

afterAll(() => {
  for (const directory of TEMP_DIRECTORIES) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const previous = { ...process.env };

afterEach(() => {
  for (const key of ['PATH', 'ATLAS_ENV_LOG', 'GIT_ALLOW_PROTOCOL', 'GIT_TERMINAL_PROMPT']) {
    if (previous[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous[key];
    }
  }
});

/** A `git` that records the two variables it was started with and succeeds with no output. */
const fakeGit = (): { log: string; seen: () => string[] } => {
  const bin = makeTempDirectory({ prefix: 'atlas-fake-git-' });
  const log = join(bin, 'seen.log');
  const script = join(bin, 'git');

  writeFileSync(
    script,
    '#!/bin/sh\nprintf "%s|%s\\n" "$GIT_ALLOW_PROTOCOL" "$GIT_TERMINAL_PROMPT" >> "$ATLAS_ENV_LOG"\nexit 0\n',
  );
  chmodSync(script, 0o755);
  writeFileSync(log, '');

  process.env.PATH = `${bin}:${previous.PATH ?? ''}`;
  process.env.ATLAS_ENV_LOG = log;

  return {
    log,
    seen: () =>
      readFileSync(log, 'utf8')
        .split('\n')
        .filter((line) => line !== ''),
  };
};

describe('AtlasGit.buildEnvironment', () => {
  test('keeps the caller environment, switches the prompt off and allows only https, ssh and file', () => {
    process.env.ATLAS_ENV_LOG = 'kept';

    const environment = AtlasGit.buildEnvironment();

    expect(environment.ATLAS_ENV_LOG).toBe('kept');
    expect(environment.GIT_TERMINAL_PROMPT).toBe('0');
    expect(environment.GIT_ALLOW_PROTOCOL).toBe('https:ssh:file');
  });

  test('replaces a value the caller set, so a hostile parent environment cannot widen the transports', () => {
    process.env.GIT_ALLOW_PROTOCOL = 'ext:git:http:file';
    process.env.GIT_TERMINAL_PROMPT = '1';

    const environment = AtlasGit.buildEnvironment();

    expect(environment.GIT_ALLOW_PROTOCOL).toBe('https:ssh:file');
    expect(environment.GIT_TERMINAL_PROMPT).toBe('0');
  });
});

describe('a local git call of atlas takes the environment too', () => {
  test('hasGit, hasClone, commitOf and the graph state run with it, whatever the parent set', () => {
    const recorder = fakeGit();
    const gitDir = makeTempDirectory({ prefix: 'atlas-local-' });

    process.env.GIT_ALLOW_PROTOCOL = 'ext:git:http:file';
    process.env.GIT_TERMINAL_PROMPT = '1';

    GithubTarball.hasGit();
    GitRepository.hasClone({ gitDir });
    GitRepository.commitOf({ gitDir, ref: 'develop' });
    GitState.trackedFiles({ root: gitDir, paths: ['.'] });
    GitState.commitOf({ root: gitDir });
    GitState.isAncestor({ root: gitDir, ancestor: 'a'.repeat(40) });

    const seen = recorder.seen();

    expect(seen).toHaveLength(6);
    expect(new Set(seen)).toEqual(new Set(['https:ssh:file|0']));
  });
});

/** Every `.ts` file under `directory`, tests and fixtures left out. */
const sourcesUnder = (directory: string): string[] =>
  readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);

    if (statSync(path).isDirectory()) {
      return name === '__tests__' ? [] : sourcesUnder(path);
    }

    return path.endsWith('.ts') ? [path] : [];
  });

/** The text of the call that starts at `start` (the opening parenthesis of `spawnSync(`), to its closing one. */
const callAt = (text: string, start: number): string => {
  let depth = 0;

  for (let index = start; index < text.length; index += 1) {
    if (text[index] === '(') {
      depth += 1;
    } else if (text[index] === ')') {
      depth -= 1;

      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return text.slice(start);
};

describe('every git call in the atlas source', () => {
  test('is given AtlasGit.buildEnvironment(): none is started with the machine environment as it is', () => {
    const missing: string[] = [];
    let calls = 0;

    for (const file of sourcesUnder(join(__dirname, '..', '..'))) {
      const text = readFileSync(file, 'utf8');

      for (const match of text.matchAll(/spawnSync\(\s*'git'/g)) {
        calls += 1;

        const call = callAt(text, match.index + 'spawnSync'.length);

        if (!call.includes('AtlasGit.buildEnvironment()')) {
          missing.push(`${file.slice(file.indexOf('/src/') + 1)} at offset ${match.index}`);
        }
      }
    }

    // The positive control: the scan did find the calls it is about.
    expect(calls).toBeGreaterThanOrEqual(15);
    expect(missing).toEqual([]);
  });

  test('the scan sees a call without the environment', () => {
    const text = "spawnSync('git', ['status'], { cwd: root });";

    expect(callAt(text, text.indexOf('(')).includes('AtlasGit.buildEnvironment()')).toBe(false);
  });
});
