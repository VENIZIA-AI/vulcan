import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';

const WORKFLOW = join(
  import.meta.dir,
  '..',
  '..',
  '..',
  '.github',
  'workflows',
  'package-release.yml',
);
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
  uses?: string;
  with?: Record<string, unknown>;
  continueOnError?: boolean;
  env?: Record<string, unknown>;
}

const isRecord = (opts: { value: unknown }): opts is { value: Record<string, unknown> } =>
  typeof opts.value === 'object' && opts.value !== null && !Array.isArray(opts.value);

const toText = (opts: { value: unknown }): string | undefined =>
  typeof opts.value === 'string' ? opts.value : undefined;

/** One job of the workflow as plain data; the YAML is data until it has the shape. */
const readJob = (opts: { name: string }): Record<string, unknown> => {
  const workflow = { value: Bun.YAML.parse(readFileSync(WORKFLOW, 'utf8')) };
  const jobs = { value: isRecord(workflow) ? workflow.value.jobs : undefined };
  const job = { value: isRecord(jobs) ? jobs.value[opts.name] : undefined };

  if (!isRecord(job)) {
    throw new Error(`[readJob] ${WORKFLOW} has no job '${opts.name}'`);
  }

  return job.value;
};

/** The publish job's steps, read through type checks. */
const readSteps = (): IWorkflowStep[] => {
  const steps = readJob({ name: 'publish' }).steps;

  if (!Array.isArray(steps)) {
    throw new Error(`[readSteps] ${WORKFLOW} has no jobs.publish.steps list`);
  }

  return steps.flatMap((value) => {
    const step = { value };

    if (!isRecord(step)) {
      return [];
    }

    const env = { value: step.value.env };
    const given = { value: step.value.with };

    return [
      {
        name: toText({ value: step.value.name }),
        if: toText({ value: step.value.if }),
        run: toText({ value: step.value.run }),
        uses: toText({ value: step.value.uses }),
        with: isRecord(given) ? given.value : undefined,
        continueOnError: step.value['continue-on-error'] === true,
        env: isRecord(env) ? env.value : undefined,
      },
    ];
  });
};

const findStep = (opts: { name: string }): IWorkflowStep => {
  const step = readSteps().find((candidate) => candidate.name === opts.name);

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
    readSteps().flatMap((step) => (step.name === undefined ? [] : [step.name]));

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

  test("it holds no token: over trusted publishing the job's own identity lets it move a dist-tag", () => {
    expect(Object.keys(findStep({ name: STEP }).env ?? {})).not.toContain('NODE_AUTH_TOKEN');
    expect(findStep({ name: STEP }).run).not.toContain('secrets.');
  });
});

describe('package-release.yml: the atlas index of the release', () => {
  const STEP = 'Publish the atlas index of the release';
  const stepNames = (): string[] =>
    readSteps().flatMap((step) => (step.name === undefined ? [] : [step.name]));
  const stepNamed = (): IWorkflowStep => {
    const step = readSteps().find((candidate) => candidate.name === STEP);

    if (step === undefined) {
      throw new Error(`[stepNamed] no step '${STEP}' in ${WORKFLOW}`);
    }

    return step;
  };

  test('the pair of the tag commit is published by the local action, with the tag as the ref', () => {
    const step = stepNamed();

    expect(step.uses).toBe('./.github/actions/atlas-index');
    expect(step.with?.['ref']).toBe('${{ env.TAG_NAME }}');
  });

  test('it runs after the tag is pushed: the release pushes with the Actions token, which starts no workflow of its own', () => {
    expect(stepNames().indexOf(STEP)).toBeGreaterThan(stepNames().indexOf('Create tag'));
  });

  test('it cannot fail a release that has already published: continue-on-error', () => {
    expect(stepNamed().continueOnError).toBe(true);
  });

  test('the signing key reaches the step as an Actions secret, nowhere else', () => {
    expect(stepNamed().env?.['ATLAS_INDEX_KEY']).toBe('${{ secrets.ATLAS_INDEX_KEY }}');
    expect(readFileSync(WORKFLOW, 'utf8').match(/secrets\.ATLAS_INDEX_KEY/g)).toHaveLength(1);
  });

  test('the job can write contents: the pair goes up as an asset of a release', () => {
    const permissions = { value: readJob({ name: 'publish' }).permissions };

    expect(isRecord(permissions) ? permissions.value.contents : undefined).toBe('write');
  });
});

describe('package-release.yml: the job graph', () => {
  const NAMES = ['plan', 'test', 'approve', 'publish'];
  const textOf = (opts: { value: unknown }): string => toText(opts) ?? '';
  const needsOf = (opts: { name: string }): string[] => {
    const needs = readJob(opts).needs;

    return Array.isArray(needs) ? needs.map((value) => textOf({ value })) : [];
  };
  const environmentOf = (opts: { name: string }): string | undefined =>
    toText({ value: readJob(opts).environment });
  const permissionsOf = (opts: { name: string }): Record<string, unknown> | undefined => {
    const permissions = { value: readJob(opts).permissions };

    return isRecord(permissions) ? permissions.value : undefined;
  };
  const workflowText = readFileSync(WORKFLOW, 'utf8');

  test('four jobs: plan, then the gates, then the approval of a stable, then the publish', () => {
    const workflow = { value: Bun.YAML.parse(workflowText) };
    const jobs = { value: isRecord(workflow) ? workflow.value.jobs : undefined };

    expect(isRecord(jobs) ? Object.keys(jobs.value) : []).toEqual(NAMES);
    expect(readJob({ name: 'test' }).needs).toBe('plan');
    expect(needsOf({ name: 'approve' })).toEqual(['plan', 'test']);
    expect(needsOf({ name: 'publish' })).toEqual(['plan', 'test', 'approve']);
  });

  test('no job is skipped by a ref guard of its own: the plan refuses a wrong ref loudly instead', () => {
    expect(workflowText).not.toContain("github.ref == 'refs/heads/develop'");
    expect(readJob({ name: 'plan' }).if).toBeUndefined();
    expect(readJob({ name: 'test' }).if).toBeUndefined();
  });

  test('the plan job holds no environment and reads only, and runs the planning script on the ref and the bump', () => {
    const steps = readJob({ name: 'plan' }).steps;
    const plan = (Array.isArray(steps) ? steps : []).find(
      (step) =>
        isRecord({ value: step }) &&
        textOf({ value: (step as Record<string, unknown>).id }) === 'plan',
    ) as Record<string, unknown> | undefined;

    expect(environmentOf({ name: 'plan' })).toBeUndefined();
    expect(permissionsOf({ name: 'plan' })).toEqual({ contents: 'read' });
    expect(textOf({ value: plan?.run })).toBe(
      'bun scripts/release/plan.ts --bump "$BUMP" --ref "$GITHUB_REF"',
    );
  });

  test('the plan outputs are what the later jobs read: version, kind and the dist-tag', () => {
    const outputs = { value: readJob({ name: 'plan' }).outputs };

    expect(isRecord(outputs) ? Object.keys(outputs.value) : []).toEqual([
      'version',
      'kind',
      'npm_tag',
    ]);
  });

  test('the environments: the stable approval is release-approval, the publish identity is npm-release, the rest have none', () => {
    expect(environmentOf({ name: 'approve' })).toBe('release-approval');
    expect(environmentOf({ name: 'publish' })).toBe('npm-release');
    expect(environmentOf({ name: 'test' })).toBeUndefined();
    expect(workflowText.match(/^ {4}environment: /gm)).toHaveLength(2);
  });

  test('only publish holds id-token, and only publish can write', () => {
    expect(permissionsOf({ name: 'publish' })).toEqual({ contents: 'write', 'id-token': 'write' });
    expect(permissionsOf({ name: 'approve' })).toEqual({});
    expect(permissionsOf({ name: 'plan' })).toEqual({ contents: 'read' });
    expect(permissionsOf({ name: 'test' })).toBeUndefined();
    expect(workflowText.match(/id-token: write/g)).toHaveLength(1);
    expect(workflowText.match(/contents: write/g)).toHaveLength(1);
  });

  test('approve exists for a stable only, runs after the gates, and runs nothing but an echo', () => {
    const steps = readJob({ name: 'approve' }).steps;

    expect(textOf({ value: readJob({ name: 'approve' }).if })).toBe(
      "${{ needs.plan.outputs.kind == 'stable' }}",
    );
    expect(textOf({ value: readJob({ name: 'approve' }).name })).toContain(
      '${{ needs.plan.outputs.version }}',
    );
    expect(Array.isArray(steps) ? steps : []).toHaveLength(1);
    expect(textOf({ value: (Array.isArray(steps) ? steps[0] : {}).run })).toStartWith('echo ');
  });

  describe('the publish condition, as a truth table', () => {
    const condition = textOf({ value: readJob({ name: 'publish' }).if })
      .replace(/^\$\{\{\s*/, '')
      .replace(/\s*\}\}$/, '')
      .replace(/\s+/g, ' ');
    const decide = (opts: {
      plan: string;
      test: string;
      approve: string;
      kind: string;
      isCancelled?: boolean;
    }): boolean =>
      runInNewContext(condition, {
        cancelled: () => opts.isCancelled === true,
        needs: {
          plan: { result: opts.plan, outputs: { kind: opts.kind } },
          test: { result: opts.test },
          approve: { result: opts.approve },
        },
      }) as boolean;

    test('a prerelease publishes with approve skipped', () => {
      expect(
        decide({ plan: 'success', test: 'success', approve: 'skipped', kind: 'prerelease' }),
      ).toBe(true);
    });

    test('a stable publishes only after approve succeeded', () => {
      expect(decide({ plan: 'success', test: 'success', approve: 'success', kind: 'stable' })).toBe(
        true,
      );
    });

    test('a stable with approve skipped does NOT publish', () => {
      expect(decide({ plan: 'success', test: 'success', approve: 'skipped', kind: 'stable' })).toBe(
        false,
      );
    });

    test('a failed, cancelled or rejected dependency stops it, for both kinds', () => {
      for (const kind of ['prerelease', 'stable']) {
        const approve = kind === 'stable' ? 'success' : 'skipped';

        expect(decide({ plan: 'failure', test: 'success', approve, kind })).toBe(false);
        expect(decide({ plan: 'success', test: 'failure', approve, kind })).toBe(false);
        expect(decide({ plan: 'success', test: 'success', approve, kind, isCancelled: true })).toBe(
          false,
        );
      }

      expect(decide({ plan: 'success', test: 'success', approve: 'failure', kind: 'stable' })).toBe(
        false,
      );
      expect(
        decide({ plan: 'success', test: 'success', approve: 'cancelled', kind: 'stable' }),
      ).toBe(false);
    });
  });

  test('the publish job takes the dist-tag from the plan and stops when its own bump disagrees', () => {
    const step = findStep({ name: 'Set the release version' });

    expect(step.env?.PLAN_VERSION).toBe('${{ needs.plan.outputs.version }}');
    expect(step.env?.PLAN_NPM_TAG).toBe('${{ needs.plan.outputs.npm_tag }}');
    expect(step.run).toContain('NPM_TAG="$PLAN_NPM_TAG"');
    expect(step.run).toContain('[ "$NEW_VERSION" != "$PLAN_VERSION" ]');
    expect(step.run).not.toContain('*-*) NPM_TAG=');
  });
});
