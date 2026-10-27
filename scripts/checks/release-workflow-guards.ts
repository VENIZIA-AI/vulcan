/**
 * The guards of the release workflow, as a check over the parsed file: the codes are the claims of the npm
 * publish-hardening card. The test of this module removes each guard from a copy of the real workflow and
 * demands that the matching code is reported; a pull request that removes a guard fails CI here.
 *
 *   C1   both jobs run only for the develop ref
 *   C2   read-only default permissions; write only on the release job
 *   C3   the release job needs the test job, which has no secret, no environment and no write
 *   C5   bun is an exact version
 *   C6   the npm token only in the steps that publish or set a dist-tag; no secret the guard does not know
 *   C6.1 the atlas key only in the atlas step
 *   C17  every checkout is the dispatched commit, and the run name carries it
 *   D6   every action is pinned by a full commit SHA (a local action is not an action to pin)
 */
const DEVELOP_ONLY = "github.ref == 'refs/heads/develop'";
const EXACT_VERSION = /^\d+\.\d+\.\d+$/;
const FULL_SHA = /@[0-9a-f]{40}$/;
const NPM_TOKEN = 'secrets.NPM_ACCESS_TOKEN';
const ATLAS_KEY = 'secrets.ATLAS_INDEX_KEY';
const NPM_STEPS = ['Publish to NPM', 'Keep next at or above latest'];
const ATLAS_STEPS = ['Publish the atlas index of the release'];
const SECRET_REFERENCE = /secrets\.[A-Za-z0-9_]+/g;

const isRecord = (opts: { value: unknown }): opts is { value: Record<string, unknown> } =>
  typeof opts.value === 'object' && opts.value !== null && !Array.isArray(opts.value);

const recordAt = (opts: { value: unknown; key: string }): Record<string, unknown> => {
  const holder = { value: opts.value };
  const child = { value: isRecord(holder) ? holder.value[opts.key] : undefined };

  return isRecord(child) ? child.value : {};
};

interface IStep {
  name: string;
  uses: string;
  withInputs: Record<string, unknown>;
  text: string;
}

const stepsOf = (opts: { job: Record<string, unknown> }): IStep[] => {
  const steps = opts.job['steps'];

  return Array.isArray(steps)
    ? steps.flatMap((step): IStep[] => {
        const holder = { value: step };

        return isRecord(holder)
          ? [
              {
                name: typeof holder.value['name'] === 'string' ? holder.value['name'] : '',
                uses: typeof holder.value['uses'] === 'string' ? holder.value['uses'] : '',
                withInputs: recordAt({ value: holder.value, key: 'with' }),
                text: JSON.stringify(holder.value),
              },
            ]
          : [];
      })
    : [];
};

/** The violations of the guards, each `<code>: <what is wrong>`; empty when the workflow keeps them all. */
export const checkReleaseWorkflowGuards = (opts: {
  workflow: Record<string, unknown>;
}): string[] => {
  const violations: string[] = [];
  const { workflow } = opts;
  const jobs = recordAt({ value: workflow, key: 'jobs' });
  const test = recordAt({ value: jobs, key: 'test' });
  const release = recordAt({ value: jobs, key: 'release' });
  const all = [...stepsOf({ job: test }), ...stepsOf({ job: release })];

  for (const [name, job] of [
    ['test', test],
    ['release', release],
  ] as const) {
    if (typeof job['if'] !== 'string' || job['if'].trim() !== DEVELOP_ONLY) {
      violations.push(`C1: the ${name} job must run only for ${DEVELOP_ONLY}`);
    }
  }

  const defaults = recordAt({ value: workflow, key: 'permissions' });

  if (defaults['contents'] !== 'read' || Object.keys(defaults).length !== 1) {
    violations.push('C2: the workflow default permissions must be exactly contents: read');
  }

  if (recordAt({ value: release, key: 'permissions' })['contents'] !== 'write') {
    violations.push('C2: the release job must state contents: write');
  }

  const testPermissions = recordAt({ value: test, key: 'permissions' });

  if (Object.values(testPermissions).some((level) => level === 'write')) {
    violations.push('C2: the test job must not have write access');
  }

  const needs = release['needs'];

  if (needs !== 'test' && !(Array.isArray(needs) && needs.includes('test'))) {
    violations.push('C3: the release job must need the test job');
  }

  if (test['environment'] !== undefined) {
    violations.push('C3: the test job must name no environment');
  }

  if (JSON.stringify(test).includes('secrets.')) {
    violations.push('C3: the test job must reference no secret');
  }

  for (const step of all.filter((entry) => entry.uses.startsWith('oven-sh/setup-bun@'))) {
    const version = step.withInputs['bun-version'];

    if (typeof version !== 'string' || !EXACT_VERSION.test(version)) {
      violations.push(
        `C5: the bun version of '${step.name}' must be exact, not ${String(version)}`,
      );
    }
  }

  for (const step of all) {
    for (const reference of new Set(step.text.match(SECRET_REFERENCE) ?? [])) {
      if (reference === NPM_TOKEN && !NPM_STEPS.includes(step.name)) {
        violations.push(`C6: '${step.name}' must not read the npm token`);
      } else if (reference === ATLAS_KEY && !ATLAS_STEPS.includes(step.name)) {
        violations.push(`C6.1: '${step.name}' must not read the atlas key`);
      } else if (reference !== NPM_TOKEN && reference !== ATLAS_KEY) {
        violations.push(`C6: '${step.name}' reads ${reference}, a secret the guard does not know`);
      }
    }
  }

  for (const step of all.filter((entry) => entry.uses.startsWith('actions/checkout@'))) {
    if (step.withInputs['ref'] !== '${{ github.sha }}') {
      violations.push(
        `C17: '${step.name}' must check out \${{ github.sha }}, the dispatched commit`,
      );
    }
  }

  if (
    typeof workflow['run-name'] !== 'string' ||
    !workflow['run-name'].includes('${{ github.sha }}')
  ) {
    violations.push('C17: the run name must carry ${{ github.sha }}');
  }

  for (const step of all.filter((entry) => entry.uses !== '' && !entry.uses.startsWith('./'))) {
    if (!FULL_SHA.test(step.uses)) {
      violations.push(
        `D6: '${step.name}' uses ${step.uses}, which is not pinned by a full commit SHA`,
      );
    }
  }

  return violations;
};
