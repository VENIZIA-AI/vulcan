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

  /** Changes the `run` text of one step of the release job in a copy of the real workflow. */
  const withRun = (opts: { step: string; change: (run: string) => string }): string[] =>
    mutated({
      change: (workflow) => {
        for (const step of stepsOf({ workflow, name: 'release' })) {
          if (step['name'] === opts.step && typeof step['run'] === 'string') {
            step['run'] = opts.change(step['run']);
          }
        }
      },
    });

  test('C20: id-token write missing from the release job, on the test job, or at the workflow level is noticed', () => {
    expect(
      mutated({
        change: (workflow) => {
          job({ workflow, name: 'release' })['permissions'] = { contents: 'write' };
        },
      }),
    ).toContain('C20');
    expect(
      mutated({
        change: (workflow) => {
          job({ workflow, name: 'test' })['permissions'] = {
            contents: 'read',
            'id-token': 'write',
          };
        },
      }),
    ).toContain('C20');
    expect(
      mutated({
        change: (workflow) => {
          workflow['permissions'] = { contents: 'read', 'id-token': 'write' };
        },
      }),
    ).toContain('C20');
  });

  test('C6: any reference to the npm token is noticed, in the publish step and in the dist-tag step too', () => {
    for (const name of ['Publish to NPM', 'Keep next at or above latest']) {
      expect(
        mutated({
          change: (workflow) => {
            for (const step of stepsOf({ workflow, name: 'release' })) {
              if (step['name'] === name) {
                step['env'] = { NODE_AUTH_TOKEN: '${{ secrets.NPM_ACCESS_TOKEN }}' };
              }
            }
          },
        }),
      ).toContain('C6');
    }

    expect(
      withRun({ step: 'Publish to NPM', change: (run) => `${run}\nexport NPM_CONFIG_TOKEN=x` }),
    ).toContain('C6');
  });

  test('C21: bun publish anywhere, a missing --provenance or a publish that is not npm of a packed tarball is noticed', () => {
    expect(withRun({ step: 'Publish to NPM', change: (run) => `${run}\nbun publish` })).toContain(
      'C21',
    );
    expect(
      withRun({ step: 'Publish to NPM', change: (run) => run.replace('--provenance', '') }),
    ).toContain('C21');
    expect(
      withRun({ step: 'Publish to NPM', change: (run) => run.replace('npm publish', 'echo') }),
    ).toContain('C21');
    expect(
      withRun({
        step: 'Publish to NPM',
        change: (run) => run.replace('$TARBALLS/$directory.tgz', '.'),
      }),
    ).toContain('C21');
    expect(
      withRun({
        step: 'Validate the packed manifests',
        change: (run) => run.replaceAll('bun pm pack', 'npm pack'),
      }),
    ).toContain('C21');
  });

  test('C23: an npm that is not exact, is older than 11.21.0, or is not asserted is noticed', () => {
    const install = 'Install the npm that publishes';

    expect(
      withRun({ step: install, change: (run) => run.replaceAll('11.21.1', 'latest') }),
    ).toContain('C23');
    expect(
      withRun({ step: install, change: (run) => run.replaceAll('11.21.1', '11.19.1') }),
    ).toContain('C23');
    expect(
      withRun({ step: install, change: (run) => run.replaceAll('npm --version', 'true') }),
    ).toContain('C23');
    expect(
      mutated({
        change: (workflow) => {
          const steps = job({ workflow, name: 'release' })['steps'];

          if (Array.isArray(steps)) {
            steps.splice(
              steps.findIndex((step) => isRecord({ value: step }) && step['name'] === install),
              1,
            );
          }
        },
      }),
    ).toContain('C23');
  });

  test('C24: a publish that does not check the recorded sha256, or a validation that records none, is noticed', () => {
    expect(
      withRun({
        step: 'Publish to NPM',
        change: (run) => run.replace('sha256sum --check', 'true'),
      }),
    ).toContain('C24');
    expect(
      withRun({
        step: 'Validate the packed manifests',
        change: (run) => run.replaceAll('sha256sum', 'true'),
      }),
    ).toContain('C24');
  });

  test('C5: a Node that is not exact, or a Node setup that caches, is noticed', () => {
    const node = (opts: { inputs: Record<string, unknown> }) =>
      mutated({
        change: (workflow) => {
          for (const step of stepsOf({ workflow, name: 'release' })) {
            if (
              typeof step['uses'] === 'string' &&
              step['uses'].startsWith('actions/setup-node@')
            ) {
              step['with'] = opts.inputs;
            }
          }
        },
      });

    expect(node({ inputs: { 'node-version': '24', 'package-manager-cache': false } })).toContain(
      'C5',
    );
    expect(node({ inputs: { 'node-version': '24.22.1' } })).toContain('C5');
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
