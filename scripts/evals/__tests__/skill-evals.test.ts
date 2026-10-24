import { afterAll, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { spawnSyncBounded } from '../../__tests__/spawn.helper.ts';

// The real `claude` is never run here: every test puts this fake first on PATH. It logs each call,
// writes an output file the way a model would, and also edits its working copy of the project, so a
// test can prove the original was never the one edited.
const FAKE_CLAUDE = `#!/usr/bin/env bun
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const args = process.argv.slice(2);
const prompt = await Bun.stdin.text();
const model = args[args.indexOf('--model') + 1];
const isGrader = args.includes('--json-schema');
const isBaselineCall = isGrader ? process.cwd().endsWith('/baseline') : !prompt.includes('<skill name=');
const arm = isBaselineCall ? 'baseline' : 'skill';
const isTargeted =
  (process.env.FAKE_CLAUDE_MODEL === undefined || process.env.FAKE_CLAUDE_MODEL === model) &&
  (process.env.FAKE_CLAUDE_ARM === undefined || process.env.FAKE_CLAUDE_ARM === arm);
const mode = isTargeted ? (process.env.FAKE_CLAUDE_MODE ?? 'pass') : 'pass';

appendFileSync(
  process.env.FAKE_CLAUDE_LOG,
  JSON.stringify({
    args,
    model,
    isGrader,
    arm,
    cwd: process.cwd(),
    hasSkill: existsSync('.claude/skills/docs-writing/SKILL.md'),
    hasSkillEvals: existsSync('.claude/skills/docs-writing/evals'),
    hasOtherCopy:
      existsSync('.agents/skills/docs-writing') ||
      existsSync('packages/cli/base/skills/docs-writing'),
    prompt,
  }) + '\\n',
);

const respond = result => console.log(JSON.stringify({ type: 'result', is_error: false, result, total_cost_usd: 0.01 }));

if (isGrader) {
  if (mode === 'malformed') {
    respond('Looks fine to me, mostly.');
  } else {
    respond(JSON.stringify({ pass: mode !== 'verdict-fails', reasons: [mode === 'verdict-fails' ? 'still a wall of text' : 'short and scannable'] }));
  }

  process.exit(0);
}

if (mode === 'timeout') {
  await Bun.sleep(60_000);
}

if (mode === 'run-fails') {
  console.error('fake claude: boom');
  process.exit(1);
}

const outputs = prompt.match(/^Output directory: (.+)$/m)[1];
const input = prompt.match(/^Input files: (.+)$/m)[1].split(', ')[0];

appendFileSync(input, '\\ntampered by the model\\n');
mkdirSync(outputs, { recursive: true });
writeFileSync(join(outputs, basename(input)), '# Rewritten\\n');
respond('done');
`;

const SCRIPT = join(import.meta.dir, '..', 'skill-evals.ts');
const EVALS_FILE = join(
  import.meta.dir,
  '..',
  '..',
  '..',
  'packages/cli/base/skills/docs-writing/evals/evals.json',
);
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

interface IFakeCall {
  args: string[];
  model: string;
  isGrader: boolean;
  arm: 'skill' | 'baseline';
  cwd: string;
  hasSkill: boolean;
  hasSkillEvals: boolean;
  hasOtherCopy: boolean;
  prompt: string;
}

interface IEvalsRun {
  code: number;
  stdout: string;
  stderr: string;
  out: string;
  project: string;
  calls: IFakeCall[];
}

/** A project holding every input file docs-writing's evals name, so a run finds them. */
const createProject = (opts: { root: string }): string => {
  const project = join(opts.root, 'project');
  const evals: { evals: { files?: string[] }[] } = JSON.parse(readFileSync(EVALS_FILE, 'utf8'));

  for (const file of evals.evals.flatMap((evaluation) => evaluation.files ?? [])) {
    mkdirSync(join(project, dirname(file)), { recursive: true });
    writeFileSync(join(project, file), `# ${basename(file)}\n\nThe original page.\n`);
  }

  // Other copies of the skill in the project, as this repository itself has: a baseline run must not see them.
  for (const copy of [
    '.agents/skills/docs-writing',
    'packages/cli/base/skills/docs-writing/evals',
  ]) {
    mkdirSync(join(project, copy), { recursive: true });
    writeFileSync(join(project, copy, 'SKILL.md'), '# a copy of the skill\n');
  }

  return project;
};

const readTree = (opts: { files: string[] }): string[] =>
  opts.files.map((file) => readFileSync(file, 'utf8'));

const runSkillEvals = (opts: {
  args: string[];
  env?: Record<string, string>;
  hasProject?: boolean;
}): IEvalsRun => {
  const root = mkdtempSync(join(tmpdir(), 'skill-evals-'));
  roots.push(root);

  const bin = join(root, 'bin');
  const log = join(root, 'claude.log');
  const out = join(root, 'out');
  const project = createProject({ root });

  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), FAKE_CLAUDE);
  chmodSync(join(bin, 'claude'), 0o755);

  const result = spawnSyncBounded({
    cmd: [
      'bun',
      SCRIPT,
      ...(opts.hasProject === false ? [] : ['--project', project]),
      '--out',
      out,
      ...opts.args,
    ],
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      FAKE_CLAUDE_LOG: log,
      ...opts.env,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const calls: IFakeCall[] = existsSync(log)
    ? readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    : [];

  return {
    code: result.exitCode ?? 1,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    out,
    project,
    calls,
  };
};

const readJson = (opts: { file: string }) => JSON.parse(readFileSync(opts.file, 'utf8'));

describe('skill-evals --dry-run', () => {
  test('prints every eval x model with its command and paths, and runs nothing', () => {
    const run = runSkillEvals({
      args: ['--skill', 'docs-writing', '--models', 'haiku,sonnet', '--dry-run'],
    });

    expect(run.code).toBe(0);
    expect(run.stdout).toContain(
      'skill-evals: docs-writing - 2 evals x 2 models = 4 runs, graded by opus',
    );
    expect(run.stdout).toContain(`skill-evals: run 0/haiku -> ${run.out}/docs-writing/0/haiku`);
    expect(run.stdout).toContain(`skill-evals: run 1/sonnet -> ${run.out}/docs-writing/1/sonnet`);
    expect(run.stdout).toContain(
      `claude -p --model haiku --output-format json --permission-mode acceptEdits --permission-prompts none --no-session-persistence --add-dir ${run.out}/docs-writing/0/haiku/outputs`,
    );
    expect(run.stdout).toContain(
      "skill-evals: grade claude -p --model opus --output-format json --tools ''",
    );
    expect(run.stdout).toContain(`skill-evals: report ${run.out}/docs-writing/report.md`);
    expect(run.stdout).toContain('skill-evals: dry run - nothing ran');
    expect(run.calls).toEqual([]);
    expect(existsSync(run.out)).toBe(false);
  });

  test('with no --out the runs are planned inside the project, never the system temp folder', () => {
    const repository = join(import.meta.dir, '..', '..', '..');
    const result = Bun.spawnSync(
      [
        'bun',
        join(repository, 'scripts/evals/skill-evals.ts'),
        '--skill',
        'docs-writing',
        '--models',
        'haiku',
        '--dry-run',
      ],
      { cwd: repository, env: { ...process.env, TMPDIR: '/nonexistent-system-tmp' } },
    );
    const stdout = result.stdout.toString();

    expect(result.exitCode).toBe(0);
    expect(stdout).toContain(`${join(repository, '.agents', 'local', 'tmp')}/skill-evals-`);
    expect(stdout).not.toContain('/nonexistent-system-tmp');
  });

  test('an input file missing from the project is named, and the dry run still exits 0', () => {
    const run = runSkillEvals({
      args: ['--skill', 'docs-writing', '--models', 'haiku', '--dry-run'],
      hasProject: false,
    });

    expect(run.code).toBe(0);
    expect(run.stdout).toContain(
      'skill-evals: ! eval 0 needs docs/wiki/content/guides/get-started/philosophy.md',
    );
    expect(run.calls).toEqual([]);
  });
});

describe('skill-evals runs', () => {
  test('a passing run: the skill reaches the model in a scratch copy, the outputs and the verdict are kept', () => {
    const run = runSkillEvals({ args: ['--skill', 'docs-writing', '--models', 'haiku'] });
    const runDirectory = join(run.out, 'docs-writing', '0', 'haiku');
    const modelCalls = run.calls.filter((call) => !call.isGrader);
    const graderCalls = run.calls.filter((call) => call.isGrader);

    expect(run.code).toBe(0);
    expect(modelCalls).toHaveLength(2);
    expect(graderCalls).toHaveLength(2);
    expect(graderCalls.every((call) => call.model === 'opus')).toBe(true);

    for (const call of modelCalls) {
      expect(call.cwd.startsWith(join(run.project, '.agents', 'local', 'tmp'))).toBe(true);
      expect(call.hasSkill).toBe(true);
      expect(call.hasSkillEvals).toBe(false);
      expect(call.prompt).toContain('<skill name="docs-writing">');
      expect(call.args).toContain('--model');
    }

    expect(readFileSync(join(runDirectory, 'outputs', 'philosophy.md'), 'utf8')).toBe(
      '# Rewritten\n',
    );
    expect(readJson({ file: join(runDirectory, 'run.json') })).toMatchObject({
      evalId: '0',
      model: 'haiku',
      exitCode: 0,
      isTimedOut: false,
      outputFiles: ['philosophy.md'],
    });
    expect(readJson({ file: join(runDirectory, 'response.json') }).result).toBe('done');
    expect(readJson({ file: join(runDirectory, 'grade.json') })).toEqual({
      pass: true,
      reasons: ['short and scannable'],
      isMalformed: false,
    });
    expect(graderCalls[0].prompt).toContain('# Rewritten');
    expect(run.stdout).toMatch(/skill-evals: 0\/haiku pass \d+\.\ds - short and scannable/);
    expect(run.stdout).toContain('skill-evals: passed 2 of 2');

    const report = readFileSync(join(run.out, 'docs-writing', 'report.md'), 'utf8');

    expect(report).toMatch(/\| 0 \| haiku \| pass \| \d+\.\ds \| short and scannable \|/);
    expect(report).toContain('**Passed 2 of 2.**');
  });

  test('the original project is never edited, though the model edits its copy', () => {
    const run = runSkillEvals({ args: ['--skill', 'docs-writing', '--models', 'haiku'] });
    const evals: { evals: { files: string[] }[] } = readJson({ file: EVALS_FILE });
    const files = evals.evals
      .flatMap((evaluation) => evaluation.files)
      .map((file) => join(run.project, file));

    expect(run.code).toBe(0);
    expect(readTree({ files }).every((content) => !content.includes('tampered'))).toBe(true);
    expect(readTree({ files }).every((content) => content.endsWith('The original page.\n'))).toBe(
      true,
    );
  });

  test('a failing verdict: exit 1, the grader reason in the line and the report', () => {
    const run = runSkillEvals({
      args: ['--skill', 'docs-writing', '--models', 'haiku'],
      env: { FAKE_CLAUDE_MODE: 'verdict-fails' },
    });

    expect(run.code).toBe(1);
    expect(run.stdout).toMatch(/skill-evals: 0\/haiku FAIL \d+\.\ds - still a wall of text/);
    expect(run.stdout).toContain('skill-evals: passed 0 of 2');
    expect(readFileSync(join(run.out, 'docs-writing', 'report.md'), 'utf8')).toContain('| FAIL |');
  });

  test('a run whose claude exits non-zero fails without a grader call; the other model still runs', () => {
    const run = runSkillEvals({
      args: ['--skill', 'docs-writing', '--models', 'haiku,sonnet'],
      env: { FAKE_CLAUDE_MODE: 'run-fails', FAKE_CLAUDE_MODEL: 'haiku' },
    });
    const runDirectory = join(run.out, 'docs-writing', '0', 'haiku');

    expect(run.code).toBe(1);
    expect(run.calls.filter((call) => call.isGrader)).toHaveLength(2);
    expect(run.stdout).toMatch(/skill-evals: 0\/haiku FAIL \d+\.\ds - claude exited 1/);
    expect(run.stdout).toMatch(/skill-evals: 0\/sonnet pass/);
    expect(run.stdout).toContain('skill-evals: passed 2 of 4');
    expect(readFileSync(join(runDirectory, 'stderr.txt'), 'utf8')).toContain('fake claude: boom');
  });

  test('a run past --timeout is killed and recorded as a failure', () => {
    const run = runSkillEvals({
      args: ['--skill', 'docs-writing', '--models', 'haiku', '--timeout', '1'],
      env: { FAKE_CLAUDE_MODE: 'timeout' },
    });

    expect(run.code).toBe(1);
    expect(run.stdout).toMatch(/skill-evals: 0\/haiku FAIL \d+\.\ds - timed out after 1s/);
    expect(
      readJson({ file: join(run.out, 'docs-writing', '0', 'haiku', 'run.json') }).isTimedOut,
    ).toBe(true);
    expect(run.calls.filter((call) => call.isGrader)).toEqual([]);
  });

  test('malformed grader output is a recorded failure, never a crash', () => {
    const run = runSkillEvals({
      args: ['--skill', 'docs-writing', '--models', 'haiku'],
      env: { FAKE_CLAUDE_MODE: 'malformed' },
    });
    const grade = readJson({ file: join(run.out, 'docs-writing', '0', 'haiku', 'grade.json') });

    expect(run.code).toBe(1);
    expect(grade.isMalformed).toBe(true);
    expect(grade.reasons[0]).toStartWith('grader output is malformed');
    expect(run.stdout).toMatch(/skill-evals: 0\/haiku FAIL \d+\.\ds - grader output is malformed/);
    expect(existsSync(join(run.out, 'docs-writing', 'report.md'))).toBe(true);
  });
});

describe('skill-evals --baseline', () => {
  const baselineArgs = ['--skill', 'docs-writing', '--models', 'haiku', '--baseline'];

  test('runs both arms: only the skill arm directory lacks baseline, each arm keeps its own files', () => {
    const run = runSkillEvals({ args: baselineArgs });
    const skillDirectory = join(run.out, 'docs-writing', '0', 'haiku');
    const baselineDirectory = join(skillDirectory, 'baseline');
    const runs = run.calls.filter((call) => !call.isGrader);

    expect(run.code).toBe(0);
    expect(runs.filter((call) => call.arm === 'skill')).toHaveLength(2);
    expect(runs.filter((call) => call.arm === 'baseline')).toHaveLength(2);
    expect(run.calls.filter((call) => call.isGrader)).toHaveLength(4);
    expect(existsSync(join(skillDirectory, 'baseline'))).toBe(true);
    expect(existsSync(join(skillDirectory, 'outputs', 'philosophy.md'))).toBe(true);
    expect(existsSync(join(skillDirectory, 'outputs', 'baseline'))).toBe(false);

    for (const file of ['run.json', 'grade.json', 'response.json', 'grader-response.json']) {
      expect(existsSync(join(baselineDirectory, file))).toBe(true);
    }

    expect(existsSync(join(baselineDirectory, 'outputs', 'philosophy.md'))).toBe(true);
    expect(readJson({ file: join(baselineDirectory, 'run.json') }).isBaseline).toBe(true);
    expect(readJson({ file: join(skillDirectory, 'run.json') }).isBaseline).toBeUndefined();
    expect(run.stdout).toContain('skill-evals: ran 0/haiku/baseline');
    expect(run.stdout).toContain('skill-evals: passed 2 of 2');
    expect(run.stdout).toContain(
      'skill-evals: haiku - skill passed 2 of 2, baseline passed 2 of 2',
    );
  });

  test('the baseline arm has no skill installed and no skill text in its prompt; the skill arm keeps both', () => {
    const run = runSkillEvals({ args: baselineArgs });
    const runs = run.calls.filter((call) => !call.isGrader);

    for (const call of runs.filter((candidate) => candidate.arm === 'baseline')) {
      expect(call.hasSkill).toBe(false);
      expect(call.hasOtherCopy).toBe(false);
      expect(call.prompt).not.toContain('<skill name=');
      expect(call.prompt).not.toContain('.claude/skills');
      expect(call.prompt).toContain('Task:');
      expect(call.prompt).toMatch(/^Output directory: .+\/baseline\/outputs$/m);
      expect(call.cwd.startsWith(join(run.project, '.agents', 'local', 'tmp'))).toBe(true);
    }

    for (const call of runs.filter((candidate) => candidate.arm === 'skill')) {
      expect(call.hasSkill).toBe(true);
      expect(call.prompt).toContain('<skill name="docs-writing">');
    }
  });

  test('the report has a skill and a baseline column and a line per model', () => {
    const run = runSkillEvals({
      args: ['--skill', 'docs-writing', '--models', 'haiku,sonnet', '--baseline'],
    });
    const report = readFileSync(join(run.out, 'docs-writing', 'report.md'), 'utf8');

    expect(report).toContain('| Eval | Model | Skill | Baseline |');
    expect(report).toMatch(/\| 0 \| haiku \| pass \| pass \| \d+\.\ds \|/);
    expect(report).toContain('- haiku: skill passed 2 of 2, baseline passed 2 of 2');
    expect(report).toContain('- sonnet: skill passed 2 of 2, baseline passed 2 of 2');
  });

  test('a failing baseline with a passing skill arm exits 0 and shows FAIL in the baseline column', () => {
    const run = runSkillEvals({
      args: baselineArgs,
      env: { FAKE_CLAUDE_MODE: 'verdict-fails', FAKE_CLAUDE_ARM: 'baseline' },
    });
    const report = readFileSync(join(run.out, 'docs-writing', 'report.md'), 'utf8');

    expect(run.code).toBe(0);
    expect(run.stdout).toContain('skill-evals: 0/haiku/baseline FAIL');
    expect(run.stdout).toContain(
      'skill-evals: haiku - skill passed 2 of 2, baseline passed 0 of 2',
    );
    expect(report).toMatch(/\| 0 \| haiku \| pass \| FAIL \|/);
  });

  test('a failing skill arm exits 1 even when the baseline passes', () => {
    const run = runSkillEvals({
      args: baselineArgs,
      env: { FAKE_CLAUDE_MODE: 'verdict-fails', FAKE_CLAUDE_ARM: 'skill' },
    });
    const report = readFileSync(join(run.out, 'docs-writing', 'report.md'), 'utf8');

    expect(run.code).toBe(1);
    expect(run.stdout).toContain('skill-evals: passed 0 of 2');
    expect(report).toMatch(/\| 0 \| haiku \| FAIL \| pass \|/);
  });

  test('without --baseline there is no baseline directory and the report keeps its shape', () => {
    const run = runSkillEvals({ args: ['--skill', 'docs-writing', '--models', 'haiku'] });

    expect(existsSync(join(run.out, 'docs-writing', '0', 'haiku', 'baseline'))).toBe(false);
    expect(run.calls.every((call) => call.arm === 'skill')).toBe(true);
    expect(readFileSync(join(run.out, 'docs-writing', 'report.md'), 'utf8')).toContain(
      '| Eval | Model | Result | Duration | First reason |',
    );
  });

  test('--dry-run plans both arms and counts the real calls, runs plus grader calls', () => {
    const run = runSkillEvals({
      args: ['--skill', 'docs-writing', '--models', 'haiku,sonnet', '--baseline', '--dry-run'],
    });

    expect(run.code).toBe(0);
    expect(run.stdout).toContain(
      'skill-evals: docs-writing - 2 evals x 2 models = 4 skill runs + 4 baseline runs, graded by opus',
    );
    expect(run.stdout).toContain(
      `skill-evals: run 0/haiku/baseline -> ${run.out}/docs-writing/0/haiku/baseline`,
    );
    expect(run.stdout).toContain(`--add-dir ${run.out}/docs-writing/0/haiku/baseline/outputs`);
    expect(run.stdout).toContain(
      'skill-evals: 16 real claude calls (8 runs + 8 grader calls), baseline included',
    );
    expect(run.calls).toEqual([]);
    expect(existsSync(run.out)).toBe(false);
  });
});

describe('skill-evals bad input exits 2', () => {
  test('a skill without evals/evals.json is named and nothing runs', () => {
    const run = runSkillEvals({ args: ['--skill', 'knowledge-sync'] });

    expect(run.code).toBe(2);
    expect(run.stderr).toContain(
      'skill-evals: packages/cli/base/skills/knowledge-sync/evals/evals.json not found - knowledge-sync has no evals',
    );
    expect(run.calls).toEqual([]);
  });

  test('an input file missing from the project stops a real run before any claude call', () => {
    const run = runSkillEvals({
      args: ['--skill', 'docs-writing', '--models', 'haiku'],
      hasProject: false,
    });

    expect(run.code).toBe(2);
    expect(run.stderr).toContain(
      'skill-evals: eval 0 needs docs/wiki/content/guides/get-started/philosophy.md',
    );
    expect(run.calls).toEqual([]);
  });

  test('an unknown argument', () => {
    const run = runSkillEvals({ args: ['--skill', 'docs-writing', '--model', 'haiku'] });

    expect(run.code).toBe(2);
    expect(run.stderr).toContain("skill-evals: unknown argument '--model'");
    expect(run.calls).toEqual([]);
  });
});
