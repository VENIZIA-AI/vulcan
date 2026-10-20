/**
 * Dispatches the NPM Release workflow for the okf/atlas/cli train, waits for it, and proves what it
 * published - the IGNIS release flow, for a train that releases in one run.
 *
 *   bun scripts/release.ts                     # prerelease, asks first
 *   bun scripts/release.ts --dry-run           # print the plan and every blocker, dispatch nothing
 *   bun scripts/release.ts --bump none --yes   # publish the version already in package.json
 *   bun scripts/release.ts --issue 12          # prefix the release commit with [#12]
 */
import {
  buildDispatchCommand,
  findPublishedVersions,
  findReleaseBlockers,
  parseReleaseArgs,
  ReleaseConstants,
} from './release-args.ts';
import type { IReleaseArgs } from './release-args.ts';

const PACKAGE_DIRECTORIES = ['okf', 'atlas', 'cli'];

const readArgs = (): IReleaseArgs | undefined => {
  try {
    return parseReleaseArgs({ args: process.argv.slice(2) });
  } catch (error) {
    console.error(`release: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
};

const capture = (opts: {
  command: string[];
  isQuiet?: boolean;
}): { code: number; stdout: string } => {
  const result = Bun.spawnSync(opts.command, {
    stdout: 'pipe',
    stderr: opts.isQuiet === true ? 'pipe' : 'inherit',
  });

  return { code: result.exitCode ?? 1, stdout: result.stdout.toString().trim() };
};

/** The newest run of the release workflow, so a new dispatch can be told apart from it. */
const findLatestRunId = (): string =>
  capture({
    command: [
      'gh',
      'run',
      'list',
      `--workflow=${ReleaseConstants.WORKFLOW}`,
      '--limit',
      '1',
      '--json',
      'databaseId',
      '--jq',
      '.[0].databaseId // ""',
    ],
  }).stdout;

/** Polls until a run newer than `previousRunId` appears, so we watch OUR dispatch and not an older one. */
const waitForNewRun = async (opts: { previousRunId: string }): Promise<string | undefined> => {
  for (let attempt = 0; attempt < 30; attempt++) {
    await Bun.sleep(4_000);

    const latest = findLatestRunId();

    if (latest.length > 0 && latest !== opts.previousRunId) {
      return latest;
    }
  }

  return undefined;
};

const args = readArgs();

if (args === undefined) {
  process.exit(2);
}

// Always fetched: the versions below are read from the local checkout, and a stale one makes the
// repository and the registry look like they disagree when they do not.
capture({ command: ['git', 'fetch', 'origin', '--quiet'] });

const counts = capture({
  command: [
    'git',
    'rev-list',
    '--left-right',
    '--count',
    `HEAD...origin/${ReleaseConstants.BRANCH}`,
  ],
}).stdout.split(/\s+/);
const blockers = findReleaseBlockers({
  branch: capture({ command: ['git', 'rev-parse', '--abbrev-ref', 'HEAD'] }).stdout,
  dirtyPaths: capture({ command: ['git', 'status', '--porcelain'] })
    .stdout.split('\n')
    .filter(Boolean).length,
  ahead: Number(counts[0] ?? 0),
  behind: Number(counts[1] ?? 0),
});

const manifests = await Promise.all(
  PACKAGE_DIRECTORIES.map(directory => Bun.file(`packages/${directory}/package.json`).json()),
);
const trainVersion: string = manifests[2].version;
const command = buildDispatchCommand({ args });

console.log(`release: the train is at ${trainVersion}; bump '${args.bump}'`);
console.log(`release: ${command.join(' ')}`);

// Reported rather than refused on a dry run: it publishes nothing, and it is most useful while the
// tree is still dirty.
for (const blocker of blockers) {
  console.log(`release: ! ${blocker}`);
}

if (args.isDryRun) {
  process.exit(0);
}

if (blockers.length > 0) {
  process.exit(1);
}

if (!args.isConfirmed && prompt('release: dispatch? [y/N]')?.trim().toLowerCase() !== 'y') {
  console.log('release: not dispatched');
  process.exit(1);
}

const previousRunId = findLatestRunId();

if (capture({ command }).code !== 0) {
  process.exit(1);
}

const runId = await waitForNewRun({ previousRunId });

if (runId === undefined) {
  console.error('release: dispatched, but no new workflow run appeared within two minutes');
  process.exit(1);
}

console.log(`release: watching run ${runId}`);

const watched = Bun.spawnSync(['gh', 'run', 'watch', runId, '--exit-status'], {
  stdio: ['inherit', 'inherit', 'inherit'],
});

if (watched.exitCode !== 0) {
  console.error(`release: run ${runId} failed - see gh run view ${runId} --log-failed`);
}

// The released version is what the run committed to develop, not what this checkout held before.
capture({ command: ['git', 'fetch', 'origin', '--quiet'] });

const released = capture({
  command: ['git', 'show', `origin/${ReleaseConstants.BRANCH}:packages/cli/package.json`],
}).stdout;
const releasedVersion: string = released.length > 0 ? JSON.parse(released).version : trainVersion;
const names: string[] = manifests.map(manifest => manifest.name);
const published = findPublishedVersions({
  log: capture({ command: ['gh', 'run', 'view', runId, '--log'] }).stdout,
  packageNames: names,
});
let isComplete = true;

for (const name of names) {
  const version = published[name];

  if (version !== undefined) {
    console.log(`release: + ${name}@${version}`);
    continue;
  }

  // A rerun skips what is already out; the registry settles whether it really is.
  const existing = capture({
    command: ['npm', 'view', `${name}@${releasedVersion}`, 'version'],
    isQuiet: true,
  }).stdout;

  if (existing === releasedVersion) {
    console.log(`release: = ${name}@${releasedVersion} (already on npm)`);
    continue;
  }

  console.error(
    `release: ${name} has no publish line in run ${runId} - check its Publish step: gh run view ${runId} --log`,
  );
  isComplete = false;
}

process.exit(watched.exitCode === 0 && isComplete ? 0 : 1);
