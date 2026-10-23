import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSyncBounded } from '../../__tests__/spawn.helper.ts';

const WORKFLOW = join(import.meta.dir, '..', '..', '..', '.github', 'workflows', 'package-release.yml');
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

interface IWorkflowStep {
  name?: string;
  if?: string;
  run?: string;
  env?: Record<string, unknown>;
}

const isRecord = (opts: { value: unknown }): opts is { value: Record<string, unknown> } =>
  typeof opts.value === 'object' && opts.value !== null && !Array.isArray(opts.value);

const toText = (opts: { value: unknown }): string | undefined =>
  typeof opts.value === 'string' ? opts.value : undefined;

/** The release job's steps, read through type checks: the YAML is data until it has the shape. */
const readSteps = (): IWorkflowStep[] => {
  const workflow = { value: Bun.YAML.parse(readFileSync(WORKFLOW, 'utf8')) };
  const jobs = { value: isRecord(workflow) ? workflow.value.jobs : undefined };
  const release = { value: isRecord(jobs) ? jobs.value.release : undefined };
  const steps = isRecord(release) ? release.value.steps : undefined;

  if (!Array.isArray(steps)) {
    throw new Error(`[readSteps] ${WORKFLOW} has no jobs.release.steps list`);
  }

  return steps.flatMap(value => {
    const step = { value };

    if (!isRecord(step)) {
      return [];
    }

    const env = { value: step.value.env };

    return [
      {
        name: toText({ value: step.value.name }),
        if: toText({ value: step.value.if }),
        run: toText({ value: step.value.run }),
        env: isRecord(env) ? env.value : undefined,
      },
    ];
  });
};

const findStep = (opts: { name: string }): IWorkflowStep => {
  const step = readSteps().find(candidate => candidate.name === opts.name);

  if (step?.run === undefined) {
    throw new Error(`[findStep] no step '${opts.name}' with a run script in ${WORKFLOW}`);
  }

  return step;
};

const run = (opts: { cmd: string[]; cwd: string; env?: Record<string, string> }) => {
  const result = spawnSyncBounded({
    cmd: opts.cmd,
    cwd: opts.cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'ci',
      GIT_AUTHOR_EMAIL: 'ci@example.dev',
      GIT_COMMITTER_NAME: 'ci',
      GIT_COMMITTER_EMAIL: 'ci@example.dev',
      ...opts.env,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  return {
    code: result.exitCode ?? 1,
    output: `${result.stdout.toString()}${result.stderr.toString()}`,
  };
};

const git = (opts: { args: string[]; cwd: string }): string => {
  const result = run({ cmd: ['git', ...opts.args], cwd: opts.cwd });

  if (result.code !== 0) {
    throw new Error(`[git] ${opts.args.join(' ')} | ${result.output}`);
  }

  return result.output.trim();
};

const writeFile = (opts: { path: string; text: string }): void => {
  mkdirSync(dirname(opts.path), { recursive: true });
  writeFileSync(opts.path, opts.text);
};

/** A bare `origin` with a develop branch, and the runner's checkout of it. */
const createRemote = (): { root: string; checkout: string } => {
  const root = mkdtempSync(join(tmpdir(), 'release-workflow-'));
  const origin = join(root, 'origin.git');
  const checkout = join(root, 'checkout');

  roots.push(root);
  git({ args: ['init', '--quiet', '--bare', '--initial-branch=develop', origin], cwd: root });
  git({ args: ['clone', '--quiet', origin, checkout], cwd: root });
  writeFile({
    path: join(checkout, 'packages', 'cli', 'package.json'),
    text: '{ "version": "0.1.0" }\n',
  });
  writeFile({ path: join(checkout, 'bun.lock'), text: '{}\n' });
  git({ args: ['add', '.'], cwd: checkout });
  git({ args: ['commit', '--quiet', '-m', 'seed'], cwd: checkout });
  git({ args: ['push', '--quiet', 'origin', 'HEAD:develop'], cwd: checkout });

  return { root, checkout };
};

/** Runs steps in order the way Actions does: bash -eo pipefail, GITHUB_ENV carried between steps. */
const runSteps = (opts: { names: string[]; cwd: string; env: Record<string, string> }) => {
  const githubEnv = join(opts.cwd, '..', 'github-env');
  const env: Record<string, string> = { ...opts.env, GITHUB_ENV: githubEnv };
  let output = '';

  writeFileSync(githubEnv, '');

  for (const name of opts.names) {
    const result = run({
      cmd: ['bash', '--noprofile', '--norc', '-eo', 'pipefail', '-c', findStep({ name }).run ?? ''],
      cwd: opts.cwd,
      env,
    });

    output += result.output;

    for (const line of readFileSync(githubEnv, 'utf8').split('\n').filter(Boolean)) {
      const separator = line.indexOf('=');

      env[line.slice(0, separator)] = line.slice(separator + 1);
    }

    if (result.code !== 0) {
      return { code: result.code, output, env };
    }
  }

  return { code: 0, output, env };
};

const RELEASE_ENV = {
  BUMP: 'preminor',
  NEW_VERSION: '0.2.0',
  TAG_NAME: 'v0.2.0',
  RELEASE_ISSUE: '',
};
const RELEASE_STEPS = ['Commit release', 'Push release', 'Create tag'];

describe('package-release.yml: tagging', () => {
  test('develop moving during the run: the tag goes on the release commit as built, not on the rebase', () => {
    const { root, checkout } = createRemote();
    const other = join(root, 'other');

    writeFile({
      path: join(checkout, 'packages', 'cli', 'package.json'),
      text: '{ "version": "0.2.0" }\n',
    });
    git({ args: ['clone', '--quiet', join(root, 'origin.git'), other], cwd: root });
    writeFile({ path: join(other, 'newer.txt'), text: 'merged mid-run\n' });
    git({ args: ['add', '.'], cwd: other });
    git({ args: ['commit', '--quiet', '-m', 'newer merge'], cwd: other });
    git({ args: ['push', '--quiet', 'origin', 'HEAD:develop'], cwd: other });

    const result = runSteps({ names: RELEASE_STEPS, cwd: checkout, env: RELEASE_ENV });

    expect(result.code, result.output).toBe(0);
    git({ args: ['fetch', '--quiet', '--tags', 'origin'], cwd: other });

    const tagged = git({ args: ['rev-parse', 'v0.2.0^{commit}'], cwd: other });

    expect(tagged).toBe(result.env.RELEASE_SHA);
    expect(git({ args: ['ls-tree', '--name-only', tagged], cwd: other })).not.toContain(
      'newer.txt',
    );
    expect(git({ args: ['log', '-1', '--format=%s', 'origin/develop'], cwd: other })).toBe(
      'chore(release): v0.2.0 [preminor]',
    );
  });

  test('a bump none retry after a finished run finds the tag at the release commit and skips it', () => {
    const { checkout } = createRemote();

    git({ args: ['tag', '-a', 'v0.1.0', '-m', 'VULCAN 0.1.0'], cwd: checkout });
    git({ args: ['push', '--quiet', 'origin', 'v0.1.0'], cwd: checkout });

    const result = runSteps({
      names: ['Create tag'],
      cwd: checkout,
      env: { BUMP: 'none', NEW_VERSION: '0.1.0', TAG_NAME: 'v0.1.0' },
    });

    expect(result.code, result.output).toBe(0);
    expect(result.output).toContain('tag: v0.1.0 is already on origin');
    expect(result.env.IS_TAGGED).toBe('true');
  });

  test('a tag on origin at a commit of ANOTHER version stops the run, and is not reported as missing', () => {
    const { checkout } = createRemote();

    writeFile({
      path: join(checkout, 'packages', 'cli', 'package.json'),
      text: '{ "version": "0.0.9" }\n',
    });
    git({ args: ['commit', '--quiet', '-am', 'an older version'], cwd: checkout });
    git({ args: ['tag', '-a', 'v0.1.0', '-m', 'VULCAN 0.1.0'], cwd: checkout });
    git({ args: ['push', '--quiet', 'origin', 'v0.1.0'], cwd: checkout });
    git({ args: ['commit', '--quiet', '--allow-empty', '-m', 'later'], cwd: checkout });

    const result = runSteps({
      names: ['Create tag'],
      cwd: checkout,
      env: { BUMP: 'none', NEW_VERSION: '0.1.0', TAG_NAME: 'v0.1.0' },
    });

    expect(result.code).not.toBe(0);
    expect(result.output).toContain('ERROR | v0.1.0 is already on origin at');
    expect(result.env.TAG_CONFLICT).toBeDefined();
    expect(findStep({ name: 'Report - tag missing' }).if).toContain("env.TAG_CONFLICT == ''");
  });

  test('a bump none run on a develop that moved on accepts the tag of the same version, and skips it', () => {
    const { checkout } = createRemote();

    git({ args: ['tag', '-a', 'v0.1.0', '-m', 'VULCAN 0.1.0'], cwd: checkout });
    git({ args: ['push', '--quiet', 'origin', 'v0.1.0'], cwd: checkout });
    git({ args: ['commit', '--quiet', '--allow-empty', '-m', 'later'], cwd: checkout });

    const result = runSteps({
      names: ['Create tag'],
      cwd: checkout,
      env: { BUMP: 'none', NEW_VERSION: '0.1.0', TAG_NAME: 'v0.1.0' },
    });

    expect(result.code, result.output).toBe(0);
    expect(result.output).toContain('tag: v0.1.0 is already on origin');
    expect(result.output).toContain('is version 0.1.0');
    expect(result.env.IS_TAGGED).toBe('true');
    expect(result.env.TAG_CONFLICT).toBeUndefined();
  });

  test('a release that committed (bump patch) never accepts a tag at another commit', () => {
    const { checkout } = createRemote();

    git({ args: ['tag', '-a', 'v0.1.0', '-m', 'VULCAN 0.1.0'], cwd: checkout });
    git({ args: ['push', '--quiet', 'origin', 'v0.1.0'], cwd: checkout });
    git({ args: ['commit', '--quiet', '--allow-empty', '-m', 'later'], cwd: checkout });

    const result = runSteps({
      names: ['Create tag'],
      cwd: checkout,
      env: {
        BUMP: 'patch',
        NEW_VERSION: '0.1.0',
        TAG_NAME: 'v0.1.0',
        RELEASE_SHA: git({ args: ['rev-parse', 'HEAD'], cwd: checkout }),
      },
    });

    expect(result.code).not.toBe(0);
    expect(result.env.TAG_CONFLICT).toBeDefined();
  });
});

describe('package-release.yml: the next dist-tag', () => {
  const STEP = 'Keep next at or above latest';
  const stepNames = (): string[] =>
    readSteps().flatMap(step => (step.name === undefined ? [] : [step.name]));

  test('a step moves next up to latest for every package in the train', () => {
    const step = findStep({ name: STEP });

    expect(step.run).toContain('bun scripts/release/next-tag.ts');
    expect(step.run).toContain('--published "$NEW_VERSION"');
    expect(step.run).toContain('--tag "$NPM_TAG"');
    expect(step.run).toContain('$PUBLISH_ORDER');
  });

  test('it runs after the publish and before the release is recorded in git', () => {
    const names = stepNames();

    expect(names.indexOf(STEP)).toBeGreaterThan(names.indexOf('Publish to NPM'));
    expect(names.indexOf(STEP)).toBeLessThan(names.indexOf('Commit release'));
  });

  test('bump none runs it too, so a dispatch with no publish heals the tags', () => {
    const step = findStep({ name: STEP });

    expect(step.if).toBeUndefined();
  });

  test('it can write dist-tags: the npm token is in its environment', () => {
    expect(Object.keys(findStep({ name: STEP }).env ?? {})).toContain('NODE_AUTH_TOKEN');
  });
});
