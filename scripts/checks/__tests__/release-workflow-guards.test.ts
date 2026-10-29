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

describe('the release workflow keeps its guards (C1 to C3, C5, C6, C16, C17, C20, C25, C26, D6)', () => {
  test('the real workflow breaks none of them', () => {
    expect(checkReleaseWorkflowGuards({ workflow: load() })).toEqual([]);
  });

  test('C1: a plan job that does not run the planning script, or that names an environment or a condition, is noticed', () => {
    expect(
      mutated({
        change: (workflow) => {
          stepsOf({ workflow, name: 'plan' }).forEach((step) => {
            if (typeof step['run'] === 'string') {
              step['run'] = 'echo nothing planned';
            }
          });
        },
      }),
    ).toContain('C1');
    expect(
      mutated({
        change: (workflow) => {
          job({ workflow, name: 'plan' })['environment'] = 'npm-release';
        },
      }),
    ).toContain('C1');
    expect(
      mutated({
        change: (workflow) => {
          job({ workflow, name: 'plan' })['if'] = "github.ref == 'refs/heads/develop'";
        },
      }),
    ).toContain('C1');
  });

  test('C1: a test job or a publish job that no longer needs the plan is noticed', () => {
    expect(
      mutated({
        change: (workflow) => {
          delete job({ workflow, name: 'test' })['needs'];
        },
      }),
    ).toContain('C1');
    expect(
      mutated({
        change: (workflow) => {
          job({ workflow, name: 'publish' })['needs'] = ['test', 'approve'];
        },
      }),
    ).toContain('C1');
  });

  test('C2 and C20: a write or an id-token on the plan or the approve job is noticed', () => {
    for (const name of ['plan', 'approve']) {
      expect(
        mutated({
          change: (workflow) => {
            job({ workflow, name })['permissions'] = { contents: 'write' };
          },
        }),
      ).toContain('C2');
      expect(
        mutated({
          change: (workflow) => {
            job({ workflow, name })['permissions'] = { 'id-token': 'write' };
          },
        }),
      ).toContain('C20');
    }
  });

  test('C25: an approve job on the wrong environment, with a permission, for every kind, or without the plan and the gates is noticed', () => {
    expect(
      mutated({
        change: (workflow) => {
          job({ workflow, name: 'approve' })['environment'] = 'npm-release';
        },
      }),
    ).toContain('C25');
    expect(
      mutated({
        change: (workflow) => {
          job({ workflow, name: 'approve' })['permissions'] = { contents: 'read' };
        },
      }),
    ).toContain('C25');
    expect(
      mutated({
        change: (workflow) => {
          delete job({ workflow, name: 'approve' })['if'];
        },
      }),
    ).toContain('C25');
    expect(
      mutated({
        change: (workflow) => {
          job({ workflow, name: 'approve' })['needs'] = ['plan'];
        },
      }),
    ).toContain('C25');
    expect(
      mutated({
        change: (workflow) => {
          job({ workflow, name: 'publish' })['needs'] = ['plan', 'test'];
        },
      }),
    ).toContain('C25');
  });

  test('C26: a publish condition that lets a stable through without its approval, or ignores a failed dependency, is noticed', () => {
    const conditions = [
      "${{ !cancelled() && needs.plan.result == 'success' && needs.test.result == 'success' }}",
      "${{ !cancelled() && needs.plan.result == 'success' && needs.test.result == 'success' && needs.approve.result != 'failure' }}",
      "${{ needs.plan.result == 'success' && needs.test.result == 'success' && (needs.approve.result == 'success' || needs.approve.result == 'skipped') }}",
      '${{ always() }}',
    ];

    for (const condition of conditions) {
      expect(
        mutated({
          change: (workflow) => {
            job({ workflow, name: 'publish' })['if'] = condition;
          },
        }),
        condition,
      ).toContain('C26');
    }

    expect(
      mutated({
        change: (workflow) => {
          delete job({ workflow, name: 'publish' })['if'];
        },
      }),
    ).toContain('C26');
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
          delete job({ workflow, name: 'publish' })['permissions'];
        },
      }),
    ).toContain('C2');
  });

  test('C3: a release job that does not need the test job, or a test job with an environment, is noticed', () => {
    expect(
      mutated({
        change: (workflow) => {
          delete job({ workflow, name: 'publish' })['needs'];
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
      for (const step of stepsOf({ workflow: opts.workflow, name: 'publish' })) {
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
            name: 'publish',
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
            name: 'publish',
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
            name: 'publish',
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
          delete job({ workflow, name: 'publish' })['environment'];
        },
      }),
    ).toContain('C16');
    expect(
      mutated({
        change: (workflow) => {
          job({ workflow, name: 'publish' })['environment'] = 'github-pages';
        },
      }),
    ).toContain('C16');
    expect(
      mutated({
        change: (workflow) => {
          job({ workflow, name: 'publish' })['environment'] = { name: 'npm-release' };
        },
      }),
    ).not.toContain('C16');
  });

  test('C17: a checkout of a branch name, or a run name without the commit, is noticed', () => {
    expect(
      mutated({
        change: (workflow) => {
          for (const step of stepsOf({ workflow, name: 'publish' })) {
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
        for (const step of stepsOf({ workflow, name: 'publish' })) {
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
          job({ workflow, name: 'publish' })['permissions'] = { contents: 'write' };
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
            for (const step of stepsOf({ workflow, name: 'publish' })) {
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
          const steps = job({ workflow, name: 'publish' })['steps'];

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
          for (const step of stepsOf({ workflow, name: 'publish' })) {
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

describe('the release workflow keeps the guards of the stable path (C27 to C30)', () => {
  const BRANCHES_MOVED = 'Refuse a stable when a branch moved since the plan';
  const MERGE_BACK = 'Merge main back into develop';

  const publishSteps = (opts: { workflow: Record<string, unknown> }): unknown[] => {
    const steps = job({ workflow: opts.workflow, name: 'publish' })['steps'];

    if (!Array.isArray(steps)) {
      throw new Error('[publishSteps] the publish job has no steps');
    }

    return steps;
  };
  const indexOfStep = (opts: { workflow: Record<string, unknown>; name: string }): number =>
    publishSteps(opts).findIndex((step) => {
      const holder = { value: step };

      return isRecord(holder) && holder.value['name'] === opts.name;
    });
  const removeStep = (opts: { workflow: Record<string, unknown>; name: string }): void => {
    publishSteps(opts).splice(indexOfStep(opts), 1);
  };

  test('C27: no branch check, one that runs for every kind, or one that comes after the publish is noticed', () => {
    expect(
      mutated({ change: (workflow) => removeStep({ workflow, name: BRANCHES_MOVED }) }),
    ).toContain('C27');
    expect(
      mutated({
        change: (workflow) => {
          const step = stepsOf({ workflow, name: 'publish' }).find(
            (entry) => entry['name'] === BRANCHES_MOVED,
          );

          delete step?.['if'];
        },
      }),
    ).toContain('C27');
    expect(
      mutated({
        change: (workflow) => {
          const steps = publishSteps({ workflow });
          const [moved] = steps.splice(indexOfStep({ workflow, name: BRANCHES_MOVED }), 1);

          steps.push(moved);
        },
      }),
    ).toContain('C27');
  });

  test('C28: no merge back, one for every kind, one without the copied script, or one before the tag is noticed', () => {
    expect(mutated({ change: (workflow) => removeStep({ workflow, name: MERGE_BACK }) })).toContain(
      'C28',
    );
    expect(
      mutated({
        change: (workflow) => {
          const step = stepsOf({ workflow, name: 'publish' }).find(
            (entry) => entry['name'] === MERGE_BACK,
          );

          delete step?.['if'];
        },
      }),
    ).toContain('C28');
    expect(
      mutated({
        change: (workflow) => {
          const step = stepsOf({ workflow, name: 'publish' }).find(
            (entry) => entry['name'] === MERGE_BACK,
          );

          if (step !== undefined) {
            step['run'] = 'bun scripts/release/merge-back.ts apply --from "$RELEASE_SHA"';
          }
        },
      }),
    ).toContain('C28');
    expect(
      mutated({
        change: (workflow) => {
          const steps = publishSteps({ workflow });
          const [merge] = steps.splice(indexOfStep({ workflow, name: MERGE_BACK }), 1);

          steps.splice(indexOfStep({ workflow, name: 'Create tag' }), 0, merge);
        },
      }),
    ).toContain('C28');
  });

  test('C28: a merge back that checks develop out in the release checkout, or one with no worktree, is noticed', () => {
    for (const run of [
      'git checkout --quiet -B develop origin/develop\nbun "$RUNNER_TEMP/merge-back.ts" apply --repo . --from "$RELEASE_SHA"',
      'cp scripts/release/merge-back.ts "$RUNNER_TEMP/merge-back.ts"\nbun "$RUNNER_TEMP/merge-back.ts" apply --from "$RELEASE_SHA"',
    ]) {
      expect(
        mutated({
          change: (workflow) => {
            const step = stepsOf({ workflow, name: 'publish' }).find(
              (entry) => entry['name'] === MERGE_BACK,
            );

            if (step !== undefined) {
              step['run'] = run;
            }
          },
        }),
        run,
      ).toContain('C28');
    }
  });

  test('C29: a force push, a moved or deleted tag, a deleted branch is noticed; a plain push is not', () => {
    for (const run of [
      'git push --force origin HEAD:main',
      'git push --force-with-lease origin HEAD:develop',
      'git push origin +HEAD:main',
      'git push origin :refs/tags/vulcan-v0.4.9',
      'git push origin --delete develop',
      'git tag -f vulcan-v0.4.9',
      'git tag -d vulcan-v0.4.9',
      'git branch -D develop',
      'git push -fu origin HEAD:main',
      'git push --mirror origin',
      'git -C "$RUNNER_TEMP/x" push --force origin HEAD:develop',
      'git push origin "+HEAD:main"',
      'git tag -fa vulcan-v0.4.9 -m x',
      'git branch -Dq develop',
      'git update-ref -d refs/heads/develop',
      'gh api -X DELETE repos/VENIZIA-AI/vulcan/git/refs/heads/develop',
    ]) {
      expect(
        mutated({
          change: (workflow) =>
            addStep({ workflow, name: 'publish', step: { name: 'Rewrite', run } }),
        }),
        run,
      ).toContain('C29');
    }

    expect(
      mutated({
        change: (workflow) =>
          addStep({
            workflow,
            name: 'publish',
            step: {
              name: 'Plain',
              run: 'git push origin HEAD:develop && git push origin vulcan-v0.4.9',
            },
          }),
      }),
    ).not.toContain('C29');
  });

  test('C30: a plan job that does not try the merge back, or does not hand develop on, is noticed', () => {
    expect(
      mutated({
        change: (workflow) => {
          stepsOf({ workflow, name: 'plan' }).forEach((step) => {
            if (typeof step['run'] === 'string') {
              step['run'] = step['run'].replace('--merge-trial', '');
            }
          });
        },
      }),
    ).toContain('C30');
    expect(
      mutated({
        change: (workflow) => {
          const outputs = job({ workflow, name: 'plan' })['outputs'];

          const holder = { value: outputs };

          if (isRecord(holder)) {
            delete holder.value['develop_sha'];
          }
        },
      }),
    ).toContain('C30');
  });
});
