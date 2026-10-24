/**
 * Runs a shipped skill's evals/evals.json against several models through `claude -p`, grades every
 * run with one grader model, and writes a report. Each run spends real model quota: dry-run first.
 *
 *   bun scripts/evals/skill-evals.ts --skill docs-writing --project ../ignis --dry-run
 *   bun scripts/evals/skill-evals.ts --skill docs-writing --project ../ignis --models haiku,sonnet
 *   bun scripts/evals/skill-evals.ts --skill docs-writing --project ../ignis --out .evals --timeout 600
 *
 * Every run works in a scratch copy of the project (no node_modules, .git or symlinks), with the skill
 * installed at .claude/skills/<name>/ and SKILL.md inline in the prompt. The original is never edited.
 */
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';
import {
  buildGraderCommand,
  buildGraderPrompt,
  buildPlan,
  buildRunPrompt,
  parseEvalsFile,
  parseSkillEvalArgs,
  parseVerdict,
  readClaudeResponse,
  renderReport,
  SkillEvalConstants,
  toCommandLine,
  toSeconds,
} from './skill-evals-core.ts';
import type {
  ISkillEval,
  ISkillEvalArgs,
  ISkillEvalResult,
  ISkillEvalRun,
  IVerdict,
} from './skill-evals-core.ts';

const REPOSITORY_ROOT = resolve(import.meta.dir, '..', '..');

// Never copied: dependencies, history and other worktrees are large, and a symlink would lead a
// model's edit out of the scratch copy into the original.
const SKIPPED_NAMES = new Set(['node_modules', '.git']);
const SKIPPED_PATHS = new Set([join('.claude', 'worktrees')]);

interface IClaudeCall {
  exitCode: number;
  isTimedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
}

interface IFinishedRun {
  run: ISkillEvalRun;
  call: IClaudeCall;
  outputFiles: string[];
  failure: string | undefined;
}

const fail = (opts: { message: string }): never => {
  console.error(`skill-evals: ${opts.message}`);
  process.exit(2);
};

const readArgs = (): ISkillEvalArgs => {
  try {
    return parseSkillEvalArgs({ args: process.argv.slice(2) });
  } catch (error) {
    return fail({ message: error instanceof Error ? error.message : String(error) });
  }
};

const callClaude = (opts: {
  command: string[];
  cwd: string;
  prompt: string;
  timeoutSeconds: number;
}): IClaudeCall => {
  const startedAt = performance.now();
  const result = Bun.spawnSync({
    cmd: opts.command,
    cwd: opts.cwd,
    stdin: Buffer.from(opts.prompt),
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: opts.timeoutSeconds * 1000,
    killSignal: 'SIGKILL',
  });

  return {
    exitCode: result.exitCode ?? 1,
    isTimedOut: result.exitedDueToTimeout === true,
    durationMs: performance.now() - startedAt,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
};

/** A copy of the project to run in, the skill under test installed without its evals - they hold the answers. */
const createScratchProject = (opts: {
  project: string;
  out: string;
  skill: string;
  skillDirectory: string;
}): string => {
  const scratch = mkdtempSync(join(tmpdir(), 'vulcan-skill-eval-'));
  const copy = join(scratch, basename(opts.project));
  const installed = join(copy, '.claude', 'skills', opts.skill);

  cpSync(opts.project, copy, {
    recursive: true,
    filter: (source) =>
      source !== opts.out &&
      !source.startsWith(`${opts.out}${sep}`) &&
      !SKIPPED_NAMES.has(basename(source)) &&
      !SKIPPED_PATHS.has(relative(opts.project, source)) &&
      !lstatSync(source).isSymbolicLink(),
  });
  rmSync(installed, { recursive: true, force: true });
  cpSync(opts.skillDirectory, installed, {
    recursive: true,
    filter: (source) => relative(opts.skillDirectory, source) !== 'evals',
  });

  return copy;
};

const listFiles = (opts: { directory: string }): string[] =>
  readdirSync(opts.directory, { recursive: true, encoding: 'utf8' })
    .filter((file) => statSync(join(opts.directory, file)).isFile())
    .sort();

const findRunFailure = (opts: {
  call: IClaudeCall;
  outputFiles: string[];
  timeoutSeconds: number;
}): string | undefined => {
  if (opts.call.isTimedOut) {
    return `timed out after ${opts.timeoutSeconds}s`;
  }

  if (opts.call.exitCode !== 0) {
    return `claude exited ${opts.call.exitCode}`;
  }

  const response = readClaudeResponse({ stdout: opts.call.stdout });

  if (response.isError) {
    return `claude reported an error: ${(response.result ?? opts.call.stdout).slice(0, 120)}`;
  }

  if (opts.outputFiles.length === 0) {
    return `no file written to ${SkillEvalConstants.OUTPUTS_DIRECTORY}/`;
  }

  return undefined;
};

const runOne = (opts: {
  run: ISkillEvalRun;
  args: ISkillEvalArgs;
  project: string;
  out: string;
  skillDirectory: string;
  skillContent: string;
}): IFinishedRun => {
  const { run } = opts;

  mkdirSync(run.outputsDirectory, { recursive: true });

  const copy = createScratchProject({
    project: opts.project,
    out: opts.out,
    skill: opts.args.skill,
    skillDirectory: opts.skillDirectory,
  });
  let call: IClaudeCall;

  try {
    call = callClaude({
      command: run.command,
      cwd: copy,
      prompt: buildRunPrompt({
        skill: opts.args.skill,
        skillContent: opts.skillContent,
        evaluation: run.evaluation,
        outputsDirectory: run.outputsDirectory,
      }),
      timeoutSeconds: opts.args.timeoutSeconds,
    });
  } finally {
    rmSync(resolve(copy, '..'), { recursive: true, force: true });
  }

  const outputFiles = listFiles({ directory: run.outputsDirectory });
  const failure = findRunFailure({ call, outputFiles, timeoutSeconds: opts.args.timeoutSeconds });

  writeFileSync(join(run.runDirectory, 'response.json'), call.stdout);
  writeFileSync(join(run.runDirectory, 'stderr.txt'), call.stderr);
  writeFileSync(
    join(run.runDirectory, 'run.json'),
    `${JSON.stringify(
      {
        evalId: run.evaluation.id,
        model: run.model,
        command: run.command,
        exitCode: call.exitCode,
        isTimedOut: call.isTimedOut,
        durationMs: Math.round(call.durationMs),
        outputFiles,
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    `skill-evals: ran ${run.evaluation.id}/${run.model} ${toSeconds({ durationMs: call.durationMs })}${failure === undefined ? '' : ` - ${failure}`}`,
  );

  return { run, call, outputFiles, failure };
};

const gradeOne = (opts: {
  finished: IFinishedRun;
  args: ISkillEvalArgs;
}): { verdict: IVerdict; costUsd: number | undefined } => {
  const { run, failure } = opts.finished;

  if (failure !== undefined) {
    return { verdict: { pass: false, reasons: [failure], isMalformed: false }, costUsd: undefined };
  }

  const call = callClaude({
    command: buildGraderCommand({ grader: opts.args.grader, maxBudgetUsd: opts.args.maxBudgetUsd }),
    cwd: run.runDirectory,
    prompt: buildGraderPrompt({
      evaluation: run.evaluation,
      outputs: opts.finished.outputFiles.map((name) => ({
        name,
        content: readFileSync(join(run.outputsDirectory, name), 'utf8'),
      })),
    }),
    timeoutSeconds: opts.args.timeoutSeconds,
  });

  writeFileSync(join(run.runDirectory, 'grader-response.json'), call.stdout);

  const costUsd = readClaudeResponse({ stdout: call.stdout }).costUsd;

  if (call.isTimedOut) {
    return {
      verdict: {
        pass: false,
        reasons: [`grader timed out after ${opts.args.timeoutSeconds}s`],
        isMalformed: false,
      },
      costUsd,
    };
  }

  if (call.exitCode !== 0) {
    return {
      verdict: { pass: false, reasons: [`grader exited ${call.exitCode}`], isMalformed: false },
      costUsd,
    };
  }

  return { verdict: parseVerdict({ stdout: call.stdout }), costUsd };
};

const addCosts = (opts: { costs: (number | undefined)[] }): number | undefined => {
  const known = opts.costs.filter((cost): cost is number => cost !== undefined);

  return known.length === 0 ? undefined : known.reduce((sum, cost) => sum + cost, 0);
};

const toCount = (opts: { count: number; noun: string }): string =>
  `${opts.count} ${opts.noun}${opts.count === 1 ? '' : 's'}`;

const readEvaluations = (opts: { skill: string; skillDirectory: string }): ISkillEval[] => {
  const evalsFile = join(SkillEvalConstants.SKILLS_DIRECTORY, opts.skill, 'evals', 'evals.json');

  if (!existsSync(join(opts.skillDirectory, 'SKILL.md'))) {
    return fail({ message: `no skill '${opts.skill}' in ${SkillEvalConstants.SKILLS_DIRECTORY}` });
  }

  if (!existsSync(join(REPOSITORY_ROOT, evalsFile))) {
    return fail({ message: `${evalsFile} not found - ${opts.skill} has no evals` });
  }

  try {
    return parseEvalsFile({
      text: readFileSync(join(REPOSITORY_ROOT, evalsFile), 'utf8'),
      skill: opts.skill,
    });
  } catch (error) {
    return fail({
      message: `${evalsFile} ${error instanceof Error ? error.message : String(error)}`,
    });
  }
};

const args = readArgs();
const skillDirectory = join(REPOSITORY_ROOT, SkillEvalConstants.SKILLS_DIRECTORY, args.skill);
const evaluations = readEvaluations({ skill: args.skill, skillDirectory });
const project = resolve(args.project ?? REPOSITORY_ROOT);

if (!existsSync(project) || !statSync(project).isDirectory()) {
  fail({ message: `--project ${project} is not a directory` });
}

const out = resolve(
  args.out ??
    join(tmpdir(), `vulcan-skill-evals-${new Date().toISOString().replace(/[:.]/g, '-')}`),
);
const plan = buildPlan({
  skill: args.skill,
  evaluations,
  models: args.models,
  out,
  maxBudgetUsd: args.maxBudgetUsd,
});
const reportFile = join(out, args.skill, 'report.md');
const missing = evaluations.flatMap((evaluation) =>
  evaluation.files
    .filter((file) => !existsSync(join(project, file)))
    .map((file) => `eval ${evaluation.id} needs ${file} - not in ${project}`),
);

console.log(
  `skill-evals: ${args.skill} - ${toCount({ count: evaluations.length, noun: 'eval' })} x ${toCount({ count: args.models.length, noun: 'model' })} = ${toCount({ count: plan.length, noun: 'run' })}, graded by ${args.grader}`,
);

if (args.isDryRun) {
  console.log(`skill-evals: project ${project} (copied per run, never edited)`);

  for (const problem of missing) {
    console.log(`skill-evals: ! ${problem}`);
  }

  for (const run of plan) {
    console.log(`skill-evals: run ${run.evaluation.id}/${run.model} -> ${run.runDirectory}`);
    console.log(`skill-evals:   ${toCommandLine({ command: run.command })}`);
  }

  console.log(
    `skill-evals: grade ${toCommandLine({ command: buildGraderCommand({ grader: args.grader, maxBudgetUsd: args.maxBudgetUsd }) })}`,
  );
  console.log(`skill-evals: report ${reportFile}`);
  console.log('skill-evals: dry run - nothing ran');
  process.exit(0);
}

if (missing.length > 0) {
  fail({ message: missing.join('\nskill-evals: ') });
}

if (Bun.which('claude') === null) {
  fail({ message: 'claude is not on PATH' });
}

const skillContent = readFileSync(join(skillDirectory, 'SKILL.md'), 'utf8');
const finishedRuns = plan.map((run) =>
  runOne({ run, args, project, out, skillDirectory, skillContent }),
);
const results: ISkillEvalResult[] = finishedRuns.map((finished) => {
  const { run, call } = finished;
  const graded = gradeOne({ finished, args });

  writeFileSync(
    join(run.runDirectory, 'grade.json'),
    `${JSON.stringify(graded.verdict, null, 2)}\n`,
  );
  console.log(
    `skill-evals: ${run.evaluation.id}/${run.model} ${graded.verdict.pass ? 'pass' : 'FAIL'} ${toSeconds({ durationMs: call.durationMs })} - ${graded.verdict.reasons[0] ?? '-'}`,
  );

  return {
    evalId: run.evaluation.id,
    model: run.model,
    durationMs: call.durationMs,
    costUsd: addCosts({
      costs: [readClaudeResponse({ stdout: call.stdout }).costUsd, graded.costUsd],
    }),
    verdict: graded.verdict,
  };
});
const passed = results.filter((result) => result.verdict.pass).length;

writeFileSync(reportFile, renderReport({ skill: args.skill, grader: args.grader, results }));
console.log(`skill-evals: passed ${passed} of ${results.length} - report ${reportFile}`);
process.exit(passed === results.length ? 0 : 1);
