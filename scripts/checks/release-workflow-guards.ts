/**
 * The guards of the release workflow, as a check over the parsed file: the codes are the claims of the npm
 * publish-hardening card. The test of this module removes each guard from a copy of the real workflow and
 * demands that the matching code is reported; a pull request that removes a guard fails CI here.
 *
 *   C1   the plan job refuses a ref and a version that do not belong together: it runs scripts/release/plan.ts on the
 *        bump and the ref, holds no environment and no write, and the test job and the publish job need it
 *   C2   read-only default permissions; write only on the publish job
 *   C3   the publish job needs the test job, which has no secret, no environment and no write
 *   C5   bun and Node are exact versions, and the Node setup does not cache
 *   C6   no npm token in any form (the release publishes through trusted publishing); no secret the guard does not know
 *   C6.1 the atlas key only in the atlas step
 *   C16  the publish job names the environment npm-release (its ref rule is a GitHub setting)
 *   C17  every checkout is the dispatched commit, and the run name carries it
 *   C20  id-token: write on the publish job and on nothing else (it is what trusted publishing signs with)
 *   C21  the release publishes a tarball bun packed, with `npm publish --provenance`; `bun publish` appears nowhere
 *   C23  an exact npm of at least 11.21.0 (the first that moves a dist-tag over OIDC) is installed and asserted
 *   C24  the tarballs are the ones validated: their sha256 is recorded at validation and checked at publish
 *   C25  the approve job is the one human stop: environment release-approval, no permission, a stable only, after
 *        the plan and the gates; the publish job needs it
 *   C26  the publish condition, evaluated: a prerelease publishes with approve skipped, a stable only after approve
 *        succeeded, and a failed or cancelled dependency stops either
 *   D6   every action is pinned by a full commit SHA (a local action is not an action to pin)
 */
import { PublishCondition } from './publish-condition.ts';

const PLAN_SCRIPT = 'scripts/release/plan.ts';
const STABLE_ONLY = "${{ needs.plan.outputs.kind == 'stable' }}";
const EXACT_VERSION = /^\d+\.\d+\.\d+$/;
const FULL_SHA = /@[0-9a-f]{40}$/;
const NPM_TOKEN_NAMES = ['NPM_ACCESS_TOKEN', 'NPM_CONFIG_TOKEN', 'NODE_AUTH_TOKEN'];
const ATLAS_KEY = 'secrets.ATLAS_INDEX_KEY';
const MINIMUM_NPM = [11, 21, 0];
const INSTALL_NPM_STEP = 'Install the npm that publishes';
const PUBLISH_STEP = 'Publish to NPM';
const VALIDATE_STEP = 'Validate the packed manifests';
const ATLAS_STEPS = ['Publish the atlas index of the release'];
const SECRET_REFERENCE = /secrets\.[A-Za-z0-9_]+/g;

const isRecord = (opts: { value: unknown }): opts is { value: Record<string, unknown> } =>
  typeof opts.value === 'object' && opts.value !== null && !Array.isArray(opts.value);

const needsOf = (opts: { job: Record<string, unknown> }): string[] => {
  const { needs } = opts.job;

  if (typeof needs === 'string') {
    return [needs];
  }

  return Array.isArray(needs)
    ? needs.filter((entry): entry is string => typeof entry === 'string')
    : [];
};

/** The environment a job names, written `environment: name` or `environment: { name: ... }`. */
const environmentNameOf = (opts: { job: Record<string, unknown> }): unknown => {
  const environment = { value: opts.job['environment'] };

  return isRecord(environment) ? environment.value['name'] : environment.value;
};

const recordAt = (opts: { value: unknown; key: string }): Record<string, unknown> => {
  const holder = { value: opts.value };
  const child = { value: isRecord(holder) ? holder.value[opts.key] : undefined };

  return isRecord(child) ? child.value : {};
};

interface IStep {
  name: string;
  uses: string;
  run: string;
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
                run: typeof holder.value['run'] === 'string' ? holder.value['run'] : '',
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
  const plan = recordAt({ value: jobs, key: 'plan' });
  const test = recordAt({ value: jobs, key: 'test' });
  const approve = recordAt({ value: jobs, key: 'approve' });
  const publishJob = recordAt({ value: jobs, key: 'publish' });
  const all = [
    ...stepsOf({ job: plan }),
    ...stepsOf({ job: test }),
    ...stepsOf({ job: approve }),
    ...stepsOf({ job: publishJob }),
  ];

  if (
    !stepsOf({ job: plan }).some(
      (step) =>
        step.run.includes(PLAN_SCRIPT) && step.run.includes('--bump') && step.run.includes('--ref'),
    )
  ) {
    violations.push(`C1: the plan job must run ${PLAN_SCRIPT} on the bump and the ref`);
  }

  if (plan['environment'] !== undefined || plan['if'] !== undefined) {
    violations.push('C1: the plan job must name no environment and carry no condition of its own');
  }

  if (!needsOf({ job: test }).includes('plan') || !needsOf({ job: publishJob }).includes('plan')) {
    violations.push('C1: the test job and the publish job must need the plan job');
  }

  const defaults = recordAt({ value: workflow, key: 'permissions' });

  if (defaults['contents'] !== 'read' || Object.keys(defaults).length !== 1) {
    violations.push('C2: the workflow default permissions must be exactly contents: read');
  }

  const publishPermissions = recordAt({ value: publishJob, key: 'permissions' });

  if (publishPermissions['contents'] !== 'write') {
    violations.push('C2: the publish job must state contents: write');
  }

  if (publishPermissions['id-token'] !== 'write') {
    violations.push('C20: the publish job must state id-token: write');
  }

  if (
    'id-token' in defaults ||
    [plan, test, approve].some((job) => 'id-token' in recordAt({ value: job, key: 'permissions' }))
  ) {
    violations.push('C20: id-token must be granted to the publish job only');
  }

  for (const [name, job] of [
    ['plan', plan],
    ['test', test],
    ['approve', approve],
  ] as const) {
    if (
      Object.values(recordAt({ value: job, key: 'permissions' })).some((level) => level === 'write')
    ) {
      violations.push(`C2: the ${name} job must not have write access`);
    }
  }

  if (environmentNameOf({ job: publishJob }) !== 'npm-release') {
    violations.push('C16: the publish job must name the environment npm-release');
  }

  if (!needsOf({ job: publishJob }).includes('test')) {
    violations.push('C3: the publish job must need the test job');
  }

  if (test['environment'] !== undefined) {
    violations.push('C3: the test job must name no environment');
  }

  const approvePermissions = { value: approve['permissions'] };

  if (environmentNameOf({ job: approve }) !== 'release-approval') {
    violations.push('C25: the approve job must name the environment release-approval');
  }

  if (!isRecord(approvePermissions) || Object.keys(approvePermissions.value).length > 0) {
    violations.push('C25: the approve job must state permissions: {} (it holds none)');
  }

  if (
    typeof approve['if'] !== 'string' ||
    approve['if'].replace(/\s+/g, ' ').trim() !== STABLE_ONLY
  ) {
    violations.push(`C25: the approve job must run for a stable only: if: ${STABLE_ONLY}`);
  }

  if (!['plan', 'test'].every((name) => needsOf({ job: approve }).includes(name))) {
    violations.push('C25: the approve job must need the plan job and the test job');
  }

  if (!needsOf({ job: publishJob }).includes('approve')) {
    violations.push('C25: the publish job must need the approve job');
  }

  const condition = typeof publishJob['if'] === 'string' ? publishJob['if'] : '';
  const wrong = PublishCondition.failures({ condition });

  if (wrong.length > 0) {
    violations.push(
      `C26: the publish condition gets ${wrong.length} case(s) wrong, the first being: ${wrong[0]}`,
    );
  }

  if (JSON.stringify(test).includes('secrets.')) {
    violations.push('C3: the test job must reference no secret');
  }

  for (const step of all.filter((entry) => entry.uses.startsWith('actions/setup-node@'))) {
    const version = step.withInputs['node-version'];

    if (typeof version !== 'string' || !EXACT_VERSION.test(version)) {
      violations.push(
        `C5: the Node version of '${step.name}' must be exact, not ${String(version)}`,
      );
    }

    if (step.withInputs['package-manager-cache'] !== false) {
      violations.push(
        `C5: '${step.name}' must set package-manager-cache: false (no cache in a release build)`,
      );
    }
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
    for (const name of NPM_TOKEN_NAMES.filter((tokenName) => step.text.includes(tokenName))) {
      violations.push(
        `C6: '${step.name}' references ${name}; the release publishes through trusted publishing and holds no npm token`,
      );
    }

    for (const reference of new Set(step.text.match(SECRET_REFERENCE) ?? [])) {
      if (reference === ATLAS_KEY && !ATLAS_STEPS.includes(step.name)) {
        violations.push(`C6.1: '${step.name}' must not read the atlas key`);
      } else if (reference !== ATLAS_KEY) {
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

  const named = (opts: { name: string }): IStep | undefined =>
    stepsOf({ job: publishJob }).find((entry) => entry.name === opts.name);
  const publish = named({ name: PUBLISH_STEP });
  const validate = named({ name: VALIDATE_STEP });
  const install = named({ name: INSTALL_NPM_STEP });

  for (const step of all.filter((entry) => entry.run.includes('bun publish'))) {
    violations.push(
      `C21: '${step.name}' runs bun publish; bun has no trusted publishing, npm publishes a tarball bun packed`,
    );
  }

  if (
    publish === undefined ||
    !publish.run.includes('npm publish') ||
    !publish.run.includes('--provenance') ||
    !publish.run.includes('$TARBALLS/$directory.tgz')
  ) {
    violations.push(
      `C21: '${PUBLISH_STEP}' must run npm publish --provenance on "$TARBALLS/$directory.tgz"`,
    );
  }

  if (validate === undefined || !validate.run.includes('bun pm pack')) {
    violations.push(
      `C21: '${VALIDATE_STEP}' must pack with bun pm pack (only bun resolves catalog: and workspace:)`,
    );
  }

  const installed = /npm install (?:--global|-g) npm@(\d+\.\d+\.\d+)(?:\s|$)/.exec(
    install?.run ?? '',
  )?.[1];
  const parts = installed?.split('.').map(Number) ?? [];
  const atLeast =
    parts.length === 3 &&
    (parts[0] - MINIMUM_NPM[0] || parts[1] - MINIMUM_NPM[1] || parts[2] - MINIMUM_NPM[2]) >= 0;

  if (installed === undefined || !atLeast || !(install?.run ?? '').includes('npm --version')) {
    violations.push(
      `C23: '${INSTALL_NPM_STEP}' must install an exact npm of at least 11.21.0 and assert it with npm --version`,
    );
  }

  if (
    validate === undefined ||
    !validate.run.includes('sha256sum') ||
    publish === undefined ||
    !publish.run.includes('sha256sum --check')
  ) {
    violations.push(
      'C24: the validation must record the sha256 of each tarball and the publish must check it',
    );
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
