import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const WORKFLOW = join(import.meta.dir, '..', '..', '..', '.github', 'workflows', 'ci.yml');

const isRecord = (opts: { value: unknown }): opts is { value: Record<string, unknown> } =>
  typeof opts.value === 'object' && opts.value !== null && !Array.isArray(opts.value);

const recordAt = (opts: { value: unknown; key: string }): Record<string, unknown> => {
  const parent = { value: opts.value };
  const child = { value: isRecord(parent) ? parent.value[opts.key] : undefined };

  return isRecord(child) ? child.value : {};
};

describe('ci.yml: every pull request runs the gates, and nothing else starts it', () => {
  const text = readFileSync(WORKFLOW, 'utf8');
  const parsed = { value: Bun.YAML.parse(text) };
  const workflow = isRecord(parsed) ? parsed.value : {};
  const triggers = recordAt({ value: workflow, key: 'on' });

  test('a pull request into develop or main starts it, and a hand dispatch still can', () => {
    expect(recordAt({ value: triggers, key: 'pull_request' })['branches']).toEqual([
      'develop',
      'main',
    ]);
    expect(triggers['workflow_dispatch']).toBeDefined();
  });

  test('there is no push trigger: a push to develop would run the gates a second time', () => {
    expect(Object.keys(triggers).sort()).toEqual(['pull_request', 'workflow_dispatch']);
    expect(triggers['workflow_dispatch'] ?? {}).toEqual({});
  });

  test('both jobs keep the full history the release table is computed from', () => {
    expect(text.match(/fetch-depth: 0/g)?.length).toBe(2);
  });

  test('there is no path filter: a required check on a pull request without a run waits for ever', () => {
    const pullRequest = recordAt({ value: triggers, key: 'pull_request' });

    expect(pullRequest['paths']).toBeUndefined();
    expect(pullRequest['paths-ignore']).toBeUndefined();
  });

  test('a newer push to a pull request cancels its older run, and nothing else is cancelled', () => {
    const concurrency = recordAt({ value: workflow, key: 'concurrency' });

    // exact, so a dropped fallback (every dispatch in one group) or a changed condition is caught
    expect(concurrency['group']).toBe('ci-${{ github.event.pull_request.number || github.ref }}');
    expect(concurrency['cancel-in-progress']).toBe("${{ github.event_name == 'pull_request' }}");
  });

  test('it reads the repository and nothing more, and never runs the code of a fork with a token', () => {
    expect(recordAt({ value: workflow, key: 'permissions' })).toEqual({ contents: 'read' });

    for (const [name, job] of Object.entries(recordAt({ value: workflow, key: 'jobs' }))) {
      expect({ name, permissions: recordAt({ value: job, key: 'permissions' }) }).toEqual({
        name,
        permissions: {},
      });
    }

    expect(text).not.toContain('pull_request_target');
    expect(text).not.toMatch(/^[^#\n]*secrets\./m);
  });
});
