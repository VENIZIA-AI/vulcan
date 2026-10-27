import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkReleaseWorkflowGuards } from '../release-workflow-guards.ts';

const WORKFLOW = join(
  import.meta.dir,
  '..',
  '..',
  '..',
  '.github',
  'workflows',
  'package-release.yml',
);

const isRecord = (opts: { value: unknown }): opts is { value: Record<string, unknown> } =>
  typeof opts.value === 'object' && opts.value !== null && !Array.isArray(opts.value);

const load = (): Record<string, unknown> => {
  const parsed = { value: Bun.YAML.parse(readFileSync(WORKFLOW, 'utf8')) };

  if (!isRecord(parsed)) {
    throw new Error(`[load] ${WORKFLOW} is not a mapping`);
  }

  return parsed.value;
};

/** A copy of the real workflow with one change made to it; the guard check must notice. */
const mutated = (opts: { change: (workflow: Record<string, unknown>) => void }): string[] => {
  const copy = load();

  opts.change(copy);

  return checkReleaseWorkflowGuards({ workflow: copy }).map((violation) =>
    violation.slice(0, violation.indexOf(':')),
  );
};

const job = (opts: {
  workflow: Record<string, unknown>;
  name: string;
}): Record<string, unknown> => {
  const jobs = { value: opts.workflow['jobs'] };
  const found = { value: isRecord(jobs) ? jobs.value[opts.name] : undefined };

  if (!isRecord(found)) {
    throw new Error(`[job] no job '${opts.name}'`);
  }

  return found.value;
};

const stepsOf = (opts: {
  workflow: Record<string, unknown>;
  name: string;
}): Record<string, unknown>[] => {
  const steps = job(opts)['steps'];

  if (!Array.isArray(steps)) {
    throw new Error(`[stepsOf] job '${opts.name}' has no steps`);
  }

  return steps.flatMap((step) => (isRecord({ value: step }) ? [step] : []));
};

/** Adds a step to the real list of a job (`stepsOf` returns a filtered copy, which is for reading). */
const addStep = (opts: {
  workflow: Record<string, unknown>;
  name: string;
  step: Record<string, unknown>;
}): void => {
  const steps = job(opts)['steps'];

  if (!Array.isArray(steps)) {
    throw new Error(`[addStep] job '${opts.name}' has no steps`);
  }

  steps.push(opts.step);
};

describe('the release workflow keeps its guards (C1 to C3, C5, C6, C16, C17, D6)', () => {
  test('the real workflow breaks none of them', () => {
    expect(checkReleaseWorkflowGuards({ workflow: load() })).toEqual([]);
  });

  test('C1: a job that runs for any ref but develop is noticed, for either job', () => {
    expect(
      mutated({
        change: (workflow) => {
          delete job({ workflow, name: 'release' })['if'];
        },
      }),
    ).toContain('C1');
    expect(
      mutated({
        change: (workflow) => {
          job({ workflow, name: 'test' })['if'] = "github.ref != 'refs/heads/x'";
        },
      }),
    ).toContain('C1');
  });

  test('C2: write access at the workflow level, a missing read default, or a write on the test job is noticed', () => {
    expect(
      mutated({
        change: (workflow) => {
          workflow['permissions'] = { contents: 'write' };
        },
      }),
    ).toContain('C2');
    expect(
      mutated({
        change: (workflow) => {
          delete workflow['permissions'];
        },
      }),
    ).toContain('C2');
    expect(
      mutated({
        change: (workflow) => {
          job({ workflow, name: 'test' })['permissions'] = { contents: 'write' };
        },
      }),
    ).toContain('C2');
    expect(
      mutated({
        change: (workflow) => {
          delete job({ workflow, name: 'release' })['permissions'];
        },
      }),
    ).toContain('C2');
  });

  test('C3: a release job that does not need the test job, or a test job with an environment, is noticed', () => {
    expect(
      mutated({
        change: (workflow) => {
          delete job({ workflow, name: 'release' })['needs'];
        },
      }),
    ).toContain('C3');
    expect(
      mutated({
        change: (workflow) => {
          job({ workflow, name: 'test' })['environment'] = 'npm-release';
        },
      }),
    ).toContain('C3');
  });

  test('C3: a secret anywhere in the test job is noticed', () => {
    expect(
      mutated({
        change: (workflow) => {
          addStep({
            workflow,
            name: 'test',
            step: { name: 'leak', run: 'true', env: { T: '${{ secrets.ANYTHING }}' } },
          });
        },
      }),
    ).toContain('C3');
  });

  test('C5: bun at latest, or at a range, is noticed', () => {
    const setup = (opts: { workflow: Record<string, unknown>; version: string }): void => {
      for (const step of stepsOf({ workflow: opts.workflow, name: 'release' })) {
        if (typeof step['uses'] === 'string' && step['uses'].startsWith('oven-sh/setup-bun@')) {
          step['with'] = { 'bun-version': opts.version };
        }
      }
    };

    expect(mutated({ change: (workflow) => setup({ workflow, version: 'latest' }) })).toContain(
      'C5',
    );
    expect(mutated({ change: (workflow) => setup({ workflow, version: '^1.4.0' }) })).toContain(
      'C5',
    );
  });

  test('C6: the npm token in a step that does not publish or set a dist-tag is noticed', () => {
    expect(
      mutated({
        change: (workflow) => {
          addStep({
            workflow,
            name: 'release',
            step: { name: 'Lint', run: 'true', env: { T: '${{ secrets.NPM_ACCESS_TOKEN }}' } },
          });
        },
      }),
    ).toContain('C6');
  });

  test('C6: a secret the guard does not know is noticed', () => {
    expect(
      mutated({
        change: (workflow) => {
          addStep({
            workflow,
            name: 'release',
            step: { name: 'x', run: 'true', env: { T: '${{ secrets.SOMETHING_ELSE }}' } },
          });
        },
      }),
    ).toContain('C6');
  });

  test('C6.1: the atlas key outside the atlas step is noticed', () => {
    expect(
      mutated({
        change: (workflow) => {
          addStep({
            workflow,
            name: 'release',
            step: { name: 'Lint', run: 'true', env: { T: '${{ secrets.ATLAS_INDEX_KEY }}' } },
          });
        },
      }),
    ).toContain('C6.1');
  });

  test('C16: a release job with no environment, or another one, is noticed', () => {
    expect(
      mutated({
        change: (workflow) => {
          delete job({ workflow, name: 'release' })['environment'];
        },
      }),
    ).toContain('C16');
    expect(
      mutated({
        change: (workflow) => {
          job({ workflow, name: 'release' })['environment'] = 'github-pages';
        },
      }),
    ).toContain('C16');
    expect(
      mutated({
        change: (workflow) => {
          job({ workflow, name: 'release' })['environment'] = { name: 'npm-release' };
        },
      }),
    ).not.toContain('C16');
  });

  test('C17: a checkout of a branch name, or a run name without the commit, is noticed', () => {
    expect(
      mutated({
        change: (workflow) => {
          for (const step of stepsOf({ workflow, name: 'release' })) {
            if (typeof step['uses'] === 'string' && step['uses'].startsWith('actions/checkout@')) {
              step['with'] = { ref: 'develop', 'fetch-depth': 0 };
            }
          }
        },
      }),
    ).toContain('C17');
    expect(
      mutated({
        change: (workflow) => {
          workflow['run-name'] = 'NPM Release';
        },
      }),
    ).toContain('C17');
  });

  test('D6: an action pinned by a tag is noticed; a local action is not', () => {
    expect(
      mutated({
        change: (workflow) => {
          for (const step of stepsOf({ workflow, name: 'test' })) {
            if (typeof step['uses'] === 'string' && step['uses'].startsWith('actions/checkout@')) {
              step['uses'] = 'actions/checkout@v6.0.3';
            }
          }
        },
      }),
    ).toContain('D6');
    expect(checkReleaseWorkflowGuards({ workflow: load() })).not.toContain('D6');
  });
});
