import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..', '..');
const WORKFLOW = join(ROOT, '.github', 'workflows', 'deploy-docs.yml');
const ACTION = join(ROOT, '.github', 'actions', 'atlas-index', 'action.yml');

const isRecord = (opts: { value: unknown }): opts is { value: Record<string, unknown> } =>
  typeof opts.value === 'object' && opts.value !== null && !Array.isArray(opts.value);

const recordAt = (opts: { value: unknown; key: string }): Record<string, unknown> => {
  const parent = { value: opts.value };
  const child = { value: isRecord(parent) ? parent.value[opts.key] : undefined };

  return isRecord(child) ? child.value : {};
};

const read = (opts: { file: string }): Record<string, unknown> => {
  const parsed = { value: Bun.YAML.parse(readFileSync(opts.file, 'utf8')) };

  return isRecord(parsed) ? parsed.value : {};
};

describe('deploy-docs.yml: Docs holds the docs deploy, the atlas index and the shared-wiki check', () => {
  const workflow = read({ file: WORKFLOW });
  const triggers = recordAt({ value: workflow, key: 'on' });
  const jobs = recordAt({ value: workflow, key: 'jobs' });
  const text = readFileSync(WORKFLOW, 'utf8');

  test('the workflow is named Docs, and its run is titled by the branch', () => {
    expect(workflow['name']).toBe('Docs');
    expect(String(workflow['run-name'])).toContain('github.ref_name');
  });

  test('the old workflows are folded in: their files are gone, their jobs are here', () => {
    const workflows = join(ROOT, '.github', 'workflows');

    expect(existsSync(join(workflows, 'atlas-index.yml'))).toBe(false);
    expect(existsSync(join(workflows, 'wiki-shared.yml'))).toBe(false);
    expect(Object.keys(jobs)).toEqual(['changes', 'build', 'deploy', 'atlas-index', 'wiki-shared']);
  });

  test('every job keeps the trigger its workflow had: docs on develop, the pair on push, the check weekly', () => {
    expect(String(recordAt({ value: jobs, key: 'build' })['if'])).toContain(
      "needs.changes.outputs.docs == 'true'",
    );
    expect(String(recordAt({ value: jobs, key: 'atlas-index' })['if'])).toContain(
      "github.event_name == 'push'",
    );
    expect(String(recordAt({ value: jobs, key: 'wiki-shared' })['if'])).toContain(
      "github.event_name == 'schedule'",
    );
    expect(triggers['schedule']).toEqual([{ cron: '17 6 * * 1' }]);
  });

  test('the docs job is decided by a check, not a path filter that would stop the other jobs', () => {
    const push = recordAt({ value: triggers, key: 'push' });

    expect(push['paths']).toBeUndefined();
    expect(text).toContain('git diff --quiet "$BEFORE" "$GITHUB_SHA" -- docs/wiki');
    expect(text).toContain('refs/heads/develop');
  });

  test('a manual run picks one job, and docs is the default (what the old deploy workflow did)', () => {
    const input = recordAt({
      value: recordAt({ value: triggers['workflow_dispatch'], key: 'inputs' }),
      key: 'job',
    });

    expect(input['options']).toEqual(['docs', 'atlas-index', 'wiki-shared']);
    expect(input['default']).toBe('docs');
  });

  test('each job holds only the permission it needs', () => {
    expect(recordAt({ value: workflow, key: 'permissions' })).toEqual({ contents: 'read' });
    expect(
      recordAt({ value: recordAt({ value: jobs, key: 'atlas-index' }), key: 'permissions' }),
    ).toEqual({ contents: 'write' });
    expect(
      recordAt({ value: recordAt({ value: jobs, key: 'deploy' }), key: 'permissions' }),
    ).toEqual({ contents: 'read', pages: 'write', 'id-token': 'write' });
    expect(
      recordAt({ value: recordAt({ value: jobs, key: 'wiki-shared' }), key: 'permissions' }),
    ).toEqual({});
  });

  test('the Pages deployments queue behind one another', () => {
    const concurrency = recordAt({
      value: recordAt({ value: jobs, key: 'deploy' }),
      key: 'concurrency',
    });

    expect(concurrency['group']).toBe('pages');
    expect(concurrency['cancel-in-progress']).toBe(false);
  });
});

describe('deploy-docs.yml: the atlas index job, a manual run with a ref', () => {
  const workflow = read({ file: WORKFLOW });
  const triggers = recordAt({ value: workflow, key: 'on' });
  const text = readFileSync(WORKFLOW, 'utf8');
  const atlasJob = recordAt({
    value: recordAt({ value: workflow, key: 'jobs' }),
    key: 'atlas-index',
  });

  test('it can be started by hand, with an optional ref input that defaults to none', () => {
    const input = recordAt({
      value: recordAt({ value: triggers['workflow_dispatch'], key: 'inputs' }),
      key: 'ref',
    });

    expect(triggers['workflow_dispatch']).toBeDefined();
    expect(input['type']).toBe('string');
    expect(input['required']).toBe(false);
    expect(input['default']).toBe('');
  });

  test('it still runs on a push to main, develop and a tag', () => {
    const push = recordAt({ value: triggers, key: 'push' });

    expect(push['branches']).toEqual(['main', 'develop']);
    expect(push['tags']).toEqual(['*']);
  });

  test('the input reaches the action through its input, never through a script', () => {
    const steps = atlasJob['steps'];
    const action = Array.isArray(steps)
      ? steps.find((step) => recordAt({ value: step, key: 'with' })['ref'] !== undefined)
      : undefined;

    expect(recordAt({ value: action, key: 'with' })['ref']).toBe('\${{ inputs.ref }}');
    expect(
      text.split('\n').filter((line) => line.includes('inputs.ref') && /^\s*run:/.test(line)),
    ).toEqual([]);
  });

  test('the checkout is the dispatched ref, with the whole history: the input ref is never checked out', () => {
    const steps = atlasJob['steps'];
    const checkout = Array.isArray(steps)
      ? steps.find((step) => JSON.stringify(step).includes('actions/checkout@'))
      : undefined;
    const checkoutText = JSON.stringify(checkout ?? {});

    expect(checkoutText).toContain('"fetch-depth":0');
    expect(checkoutText).not.toContain('inputs.ref');
  });

  test('runs for different refs do not queue behind or replace one another', () => {
    const concurrency = recordAt({ value: atlasJob, key: 'concurrency' });

    expect(String(concurrency['group'])).toContain('inputs.ref');
    expect(concurrency['cancel-in-progress']).toBe(false);
  });
});

describe('the atlas-index action: the ref input', () => {
  const action = read({ file: ACTION });
  const text = readFileSync(ACTION, 'utf8');

  test('an optional ref input, empty by default', () => {
    const input = recordAt({ value: recordAt({ value: action, key: 'inputs' }), key: 'ref' });

    expect(input['required']).toBe(false);
    expect(input['default']).toBe('');
  });

  test('the ref goes to the command as an environment variable, never inside the script text', () => {
    const steps = recordAt({ value: action, key: 'runs' })['steps'];
    const step = { value: Array.isArray(steps) ? steps[0] : undefined };
    const run = isRecord(step) ? step.value['run'] : undefined;

    expect(recordAt({ value: step.value, key: 'env' })['ATLAS_REF']).toBe('${{ inputs.ref }}');
    expect(typeof run === 'string' ? run : '').not.toContain('${{');
    expect(text).toContain('--ref "$ATLAS_REF"');
  });
});
