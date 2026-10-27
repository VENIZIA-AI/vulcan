import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..', '..');
const WORKFLOW = join(ROOT, '.github', 'workflows', 'atlas-index.yml');
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

describe('atlas-index.yml: a manual run with a ref', () => {
  const workflow = read({ file: WORKFLOW });
  const triggers = recordAt({ value: workflow, key: 'on' });
  const text = readFileSync(WORKFLOW, 'utf8');

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
    const jobs = recordAt({ value: workflow, key: 'jobs' });
    const steps = recordAt({ value: jobs, key: 'publish' })['steps'];
    const action = Array.isArray(steps)
      ? steps.find((step) => recordAt({ value: step, key: 'with' })['ref'] !== undefined)
      : undefined;

    expect(recordAt({ value: action, key: 'with' })['ref']).toBe('\${{ inputs.ref }}');
    expect(
      text.split('\n').filter((line) => line.includes('inputs.ref') && /^\s*run:/.test(line)),
    ).toEqual([]);
  });

  test('the checkout is the dispatched ref, with the whole history: the input ref is never checked out', () => {
    const checkout = text.split('Checkout')[1] ?? '';

    expect(checkout.split('Setup Bun')[0]).toContain('fetch-depth: 0');
    expect(checkout.split('Setup Bun')[0]).not.toContain('inputs.ref');
  });

  test('runs for different refs do not queue behind or replace one another', () => {
    const concurrency = recordAt({ value: workflow, key: 'concurrency' });

    expect(String(concurrency['group'])).toContain('inputs.ref');
    expect(concurrency['cancel-in-progress']).toBe(false);
  });

  test('the run is named for the ref it publishes', () => {
    expect(String(workflow['run-name'])).toContain('inputs.ref');
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
