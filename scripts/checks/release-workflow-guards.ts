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
 *   C17  every checkout is the dispatched commit, and the run name carries it (the label ends in its short form)
 *   C20  id-token: write on the publish job and on nothing else (it is what trusted publishing signs with)
 *   C21  the release publishes a tarball bun packed, with `npm publish --provenance`; `bun publish` appears nowhere
 *   C23  an exact npm of at least 11.21.0 (the first that moves a dist-tag over OIDC) is installed and asserted
 *   C24  the tarballs are the ones validated: their sha256 is recorded at validation and checked at publish
 *   C25  the approve job is the one human stop: environment release-approval, no permission, a stable only, after
 *        the plan and the gates; the publish job needs it
 *   C26  the publish condition, evaluated: a prerelease publishes with approve skipped, a stable only after approve
 *        succeeded, and a failed or cancelled dependency stops either
 *   C27  a stable checks before it publishes that main and develop are where the plan saw them
 *   C28  a stable merges main back into develop after the tag and before the atlas index, from a copy of the script
 *        and a worktree of develop, so the checkout stays on the release commit
 *   C29  nothing force-pushes, moves or deletes a tag, or deletes a branch
 *   C30  the plan job tries the merge back of a stable (--merge-trial) and hands develop's head on
 *   C31  the publish job makes the GitHub Release after the tag and cannot fail the run for it
 *   C32  a job that installs npm globally sets up Node first: the runner's own prefix is not writable, so a global
 *        install without a setup-node step fails with EACCES (it failed the first prerelease in the plan job)
 *   C33  the run title is the dispatcher's label, and the plan job passes it to plan.ts, which refuses one that is not
 *        what it computed (the title cannot name a version, a package set or a commit the run does not release);
 *        the label is read nowhere else than the run name and the env of that step, and the plan job has no
 *        continue-on-error
 *   D6   every action is pinned by a full commit SHA (a local action is not an action to pin)
 */
import { PublishCondition } from './publish-condition.ts';

const PLAN_SCRIPT = 'scripts/release/plan.ts';
const STABLE_ONLY = "${{ needs.plan.outputs.kind == 'stable' }}";
/** What the step conditions of a stable-only step say, without the expression braces. */
const STABLE_CONDITION = "needs.plan.outputs.kind == 'stable'";
const EXACT_VERSION = /^\d+\.\d+\.\d+$/;
const FULL_SHA = /@[0-9a-f]{40}$/;
/**
 * A read of the `label` input in an expression: `inputs.label`, `inputs['label']`, or the whole inputs or event
 * object. Expression names and functions are not case sensitive.
 */
const LABEL_READER =
  /\binputs\s*(?:\.\s*label\b|\[\s*(?:'|\\")label\b)|toJSON\(\s*(?:github(?:\.event(?:\.inputs)?)?|inputs)\s*\)/gi;
const NPM_TOKEN_NAMES = ['NPM_ACCESS_TOKEN', 'NPM_CONFIG_TOKEN', 'NODE_AUTH_TOKEN'];
const ATLAS_KEY = 'secrets.ATLAS_INDEX_KEY';
const MINIMUM_NPM = [11, 21, 0];
const INSTALL_NPM_STEP = 'Install the npm that publishes';
const PUBLISH_STEP = 'Publish to NPM';
const VALIDATE_STEP = 'Validate the packed manifests';
const ATLAS_STEPS = ['Publish the atlas index of the release'];
const SECRET_REFERENCE = /secrets\.[A-Za-z0-9_]+/g;
const BRANCHES_MOVED_STEP = 'Refuse a stable when a branch moved since the plan';
const MERGE_BACK_STEP = 'Merge main back into develop';
const RELEASE_STEP = 'Create the GitHub Release';
/** `npm install --global ...` or `npm i -g ...`: it writes to the global prefix of the npm on the PATH. */
const GLOBAL_NPM_INSTALL = /\bnpm\s+(?:install|i)\b[^\n]*(?:--global\b|\s-g\b)/;
const TAG_STEP = 'Create tag';
const VERSION_STEP = 'Set the release version';
/** A git command that rewrites or removes history the release has already made public. */
const DESTRUCTIVE_GIT: { name: string; pattern: RegExp }[] = [
  {
    name: 'a push that forces, deletes, mirrors or prunes, or pushes a + or : refspec',
    pattern:
      /\bgit\b[^\n]*\bpush\b[^\n]*(?:--force|--delete|--mirror|--prune|\s-[A-Za-z]*f[A-Za-z]*\b|\s["']?[+:]\S)/,
  },
  {
    name: 'a tag that is forced, replaced or deleted',
    pattern: /\bgit\b[^\n]*\btag\b[^\n]*(?:--force|--delete|\s-[A-Za-z]*[fd][A-Za-z]*\b)/,
  },
  {
    name: 'a branch that is deleted',
    pattern: /\bgit\b[^\n]*\bbranch\b[^\n]*(?:--delete|\s-[A-Za-z]*[Dd][A-Za-z]*\b)/,
  },
  {
    name: 'a ref that is deleted',
    pattern: /\bgit\b[^\n]*\bupdate-ref\b[^\n]*\s-d\b|\bgh\s+api\b[^\n]*(?:-X|--method)\s+DELETE/,
  },
];

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

  if (
    !stepsOf({ job: plan }).some(
      (step) => step.run.includes(PLAN_SCRIPT) && step.run.includes('--merge-trial'),
    ) ||
    !JSON.stringify(plan['outputs'] ?? {}).includes('develop_sha')
  ) {
    violations.push('C30: the plan job must run plan.ts with --merge-trial and output develop_sha');
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

  const runName = workflow['run-name'];

  // The title is the dispatcher's label, which ends in the short commit and which the plan job checks (C33), or the
  // whole commit for a dispatch by hand.
  if (
    typeof runName !== 'string' ||
    !/\$\{\{\s*inputs\.label\s*\|\|[\s\S]*github\.sha[\s\S]*\}\}\s*$/.test(runName)
  ) {
    violations.push(
      'C17: the run name must be one expression, ${{ inputs.label || ... github.sha ... }}: the label (which ends in the short commit) and, for a dispatch by hand, the whole commit',
    );
  }

  if (
    !stepsOf({ job: plan }).some(
      (step) =>
        step.run.includes(PLAN_SCRIPT) &&
        step.run.includes('--label "$RELEASE_LABEL"') &&
        step.run.includes('--train packages') &&
        step.text.includes('"RELEASE_LABEL":"${{ inputs.label }}"'),
    )
  ) {
    violations.push(
      'C33: the plan job must pass the label input to plan.ts (--label "$RELEASE_LABEL", from inputs.label in the step env) and the train (--train packages, without which plan.ts skips the label check), so the run title is checked',
    );
  }

  // The label is read in two places and nowhere else: the run name, and the env of the plan step. Another reader (a
  // step that echoes it, a script that takes it as text) would act on a value nobody has checked.
  const labelReaders = JSON.stringify({ ...workflow, 'run-name': '' }).match(LABEL_READER);

  if (labelReaders !== null && labelReaders.length > 1) {
    violations.push(
      `C33: inputs.label is read ${labelReaders.length} times outside the run name; only the env of the plan step may read it`,
    );
  }

  // A plan step that may fail without failing the job would let a refused label through.
  if (JSON.stringify(plan).includes('"continue-on-error"')) {
    violations.push(
      'C33: the plan job must not set continue-on-error (a plan step that may fail would let a refused label through)',
    );
  }

  const named = (opts: { name: string }): IStep | undefined =>
    stepsOf({ job: publishJob }).find((entry) => entry.name === opts.name);
  const publish = named({ name: PUBLISH_STEP });
  const validate = named({ name: VALIDATE_STEP });
  const install = named({ name: INSTALL_NPM_STEP });

  const publishSteps = stepsOf({ job: publishJob });
  const position = (opts: { name: string }): number =>
    publishSteps.findIndex((entry) => entry.name === opts.name);
  const stableOnly = (opts: { step: IStep | undefined }): boolean =>
    opts.step?.text.includes(STABLE_CONDITION) ?? false;
  const guard = named({ name: BRANCHES_MOVED_STEP });

  if (
    guard === undefined ||
    !stableOnly({ step: guard }) ||
    !guard.run.includes('$GITHUB_SHA') ||
    !guard.text.includes('PLAN_DEVELOP_SHA') ||
    position({ name: BRANCHES_MOVED_STEP }) > position({ name: VERSION_STEP }) ||
    position({ name: BRANCHES_MOVED_STEP }) > position({ name: PUBLISH_STEP })
  ) {
    violations.push(
      `C27: '${BRANCHES_MOVED_STEP}' must run for a stable only, compare main with $GITHUB_SHA and develop with the plan's head, and come before the version and the publish`,
    );
  }

  const merge = named({ name: MERGE_BACK_STEP });

  if (
    merge === undefined ||
    !stableOnly({ step: merge }) ||
    !merge.run.includes('cp scripts/release/merge-back.ts "$RUNNER_TEMP/merge-back.ts"') ||
    !merge.run.includes('git worktree add --detach "$RUNNER_TEMP/develop-merge" origin/develop') ||
    !merge.run.includes('merge-back.ts" apply --repo "$RUNNER_TEMP/develop-merge"') ||
    merge.run.includes('git checkout') ||
    position({ name: TAG_STEP }) < 0 ||
    position({ name: MERGE_BACK_STEP }) < position({ name: TAG_STEP }) ||
    position({ name: MERGE_BACK_STEP }) > position({ name: ATLAS_STEPS[0] })
  ) {
    violations.push(
      `C28: '${MERGE_BACK_STEP}' must run for a stable only, after '${TAG_STEP}' and before the atlas index, from a copy of main's merge-back.ts and a worktree of develop, never a checkout of develop`,
    );
  }

  const githubRelease = named({ name: RELEASE_STEP });

  if (
    githubRelease === undefined ||
    !githubRelease.text.includes('"continue-on-error":true') ||
    !githubRelease.run.includes('scripts/release/github-release.ts create --tag "$TAG_NAME"') ||
    !githubRelease.text.includes('"GH_TOKEN":"${{ github.token }}"') ||
    position({ name: RELEASE_STEP }) < position({ name: TAG_STEP }) ||
    position({ name: TAG_STEP }) < 0
  ) {
    violations.push(
      `C31: '${RELEASE_STEP}' must come after '${TAG_STEP}', continue on error, use the job's github.token and run github-release.ts create on the tag`,
    );
  }

  for (const step of all) {
    for (const { name } of DESTRUCTIVE_GIT.filter((candidate) =>
      candidate.pattern.test(step.run),
    )) {
      violations.push(`C29: '${step.name}' runs ${name}`);
    }
  }

  for (const [jobName, job] of Object.entries({ plan, test, approve, publish: publishJob })) {
    const steps = stepsOf({ job });

    steps.forEach((step, index) => {
      const installsGlobally = GLOBAL_NPM_INSTALL.test(step.run);
      const hasNode = steps
        .slice(0, index)
        .some((earlier) => earlier.uses.startsWith('actions/setup-node@'));

      if (installsGlobally && !hasNode) {
        violations.push(
          `C32: '${step.name}' in the ${jobName} job installs npm globally with no earlier actions/setup-node step: the runner's prefix is not writable (EACCES)`,
        );
      }
    });
  }

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
