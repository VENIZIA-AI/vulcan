import { join } from 'node:path';

export class SkillEvalConstants {
  static readonly MODELS = ['haiku', 'sonnet', 'opus'];
  static readonly GRADER = 'opus';
  static readonly TIMEOUT_SECONDS = 900;
  static readonly SKILLS_DIRECTORY = 'packages/cli/base/skills';
  static readonly OUTPUTS_DIRECTORY = 'outputs';
}

export interface ISkillEvalArgs {
  skill: string;
  models: string[];
  grader: string;
  project: string | undefined;
  out: string | undefined;
  timeoutSeconds: number;
  /** Passed to every `claude` call as `--max-budget-usd`; no cap when absent. */
  maxBudgetUsd: string | undefined;
  isDryRun: boolean;
}

export interface ISkillEval {
  id: string;
  prompt: string;
  expectedOutput: string;
  files: string[];
}

export interface ISkillEvalRun {
  evaluation: ISkillEval;
  model: string;
  runDirectory: string;
  outputsDirectory: string;
  command: string[];
}

export interface IVerdict {
  pass: boolean;
  reasons: string[];
  isMalformed: boolean;
}

export interface IClaudeResponse {
  result: string | undefined;
  isError: boolean;
  costUsd: number | undefined;
  structuredOutput: unknown;
}

export interface ISkillEvalResult {
  evalId: string;
  model: string;
  durationMs: number;
  costUsd: number | undefined;
  verdict: IVerdict;
}

const VALUE_FLAGS = new Set([
  '--skill',
  '--models',
  '--grader',
  '--project',
  '--out',
  '--timeout',
  '--max-budget-usd',
]);
const BOOLEAN_FLAGS = new Set(['--dry-run']);

// Names become path segments under <out>, so anything that could climb out of it is refused.
const PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    reasons: { type: 'array', items: { type: 'string' } },
  },
  required: ['pass', 'reasons'],
};

/** Reads `--skill <name> [--models a,b] [--grader m] [--project d] [--out d] [--timeout s] [--max-budget-usd n] [--dry-run]`. */
export const parseSkillEvalArgs = (opts: { args: string[] }): ISkillEvalArgs => {
  const values = new Map<string, string>();
  const booleans = new Set<string>();

  for (let index = 0; index < opts.args.length; index++) {
    const arg = opts.args[index];

    if (BOOLEAN_FLAGS.has(arg)) {
      booleans.add(arg);
      continue;
    }

    if (!VALUE_FLAGS.has(arg)) {
      throw new Error(`unknown argument '${arg}'`);
    }

    const value = opts.args[index + 1];

    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${arg} needs a value`);
    }

    values.set(arg, value);
    index++;
  }

  const skill = values.get('--skill');

  if (skill === undefined) {
    throw new Error('--skill <name> is required');
  }

  if (!PATH_SEGMENT.test(skill)) {
    throw new Error(`--skill '${skill}' is not a skill name`);
  }

  const models = (values.get('--models')?.split(',') ?? SkillEvalConstants.MODELS)
    .map(model => model.trim())
    .filter(model => model.length > 0);
  const grader = values.get('--grader') ?? SkillEvalConstants.GRADER;

  for (const model of models) {
    if (!PATH_SEGMENT.test(model)) {
      throw new Error(`--models '${model}' is not a model name`);
    }
  }

  if (!PATH_SEGMENT.test(grader)) {
    throw new Error(`--grader '${grader}' is not a model name`);
  }

  if (models.length === 0) {
    throw new Error('--models needs at least one model');
  }

  const timeout = values.get('--timeout') ?? String(SkillEvalConstants.TIMEOUT_SECONDS);

  if (!/^\d+$/.test(timeout) || Number(timeout) === 0) {
    throw new Error(`--timeout needs whole seconds above 0, got: ${timeout}`);
  }

  const maxBudgetUsd = values.get('--max-budget-usd');

  if (
    maxBudgetUsd !== undefined &&
    !(/^\d+(\.\d+)?$/.test(maxBudgetUsd) && Number(maxBudgetUsd) > 0)
  ) {
    throw new Error(`--max-budget-usd needs a dollar amount above 0, got: ${maxBudgetUsd}`);
  }

  return {
    skill,
    models,
    grader,
    project: values.get('--project'),
    out: values.get('--out'),
    timeoutSeconds: Number(timeout),
    maxBudgetUsd,
    isDryRun: booleans.has('--dry-run'),
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A skill's `evals/evals.json`, in skill-creator's shape: `{ skill_name, evals: [{ id, prompt, expected_output, files }] }`. */
export const parseEvalsFile = (opts: { text: string; skill: string }): ISkillEval[] => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(opts.text);
  } catch (error) {
    throw new Error(`is not JSON (${error instanceof Error ? error.message : String(error)})`);
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.evals)) {
    throw new Error('needs { skill_name, evals: [...] }');
  }

  if (parsed.skill_name !== opts.skill) {
    throw new Error(`skill_name is '${String(parsed.skill_name)}', expected '${opts.skill}'`);
  }

  if (parsed.evals.length === 0) {
    throw new Error('has no evals');
  }

  return parsed.evals.map((entry: unknown, index: number): ISkillEval => {
    if (
      !isRecord(entry) ||
      (typeof entry.id !== 'number' && typeof entry.id !== 'string') ||
      typeof entry.prompt !== 'string' ||
      typeof entry.expected_output !== 'string'
    ) {
      throw new Error(`evals[${index}] needs id, prompt and expected_output`);
    }

    const id = String(entry.id);

    if (!PATH_SEGMENT.test(id)) {
      throw new Error(`evals[${index}] id '${id}' must be letters, digits, '.', '_' or '-'`);
    }

    const files = Array.isArray(entry.files)
      ? entry.files.filter((file): file is string => typeof file === 'string')
      : [];

    return { id, prompt: entry.prompt, expectedOutput: entry.expected_output, files };
  });
};

/**
 * The run: print mode, JSON out, file edits accepted, and anything that would still prompt is denied
 * instead of waiting for a human who is not there. The outputs directory sits outside the project
 * copy, so it is added explicitly.
 */
const budgetFlags = (opts: { maxBudgetUsd?: string }): string[] =>
  opts.maxBudgetUsd === undefined ? [] : ['--max-budget-usd', opts.maxBudgetUsd];

export const buildRunCommand = (opts: {
  model: string;
  outputsDirectory: string;
  maxBudgetUsd?: string;
}): string[] => [
  'claude',
  '-p',
  '--model',
  opts.model,
  '--output-format',
  'json',
  '--permission-mode',
  'acceptEdits',
  '--permission-prompts',
  'none',
  '--no-session-persistence',
  '--add-dir',
  opts.outputsDirectory,
  ...budgetFlags(opts),
];

/** The grader reads everything from its prompt, so it gets no tools at all. */
export const buildGraderCommand = (opts: { grader: string; maxBudgetUsd?: string }): string[] => [
  'claude',
  '-p',
  '--model',
  opts.grader,
  '--output-format',
  'json',
  '--tools',
  '',
  '--json-schema',
  JSON.stringify(VERDICT_SCHEMA),
  '--permission-prompts',
  'none',
  '--no-session-persistence',
  ...budgetFlags(opts),
];

export const buildPlan = (opts: {
  skill: string;
  evaluations: ISkillEval[];
  models: string[];
  out: string;
  maxBudgetUsd?: string;
}): ISkillEvalRun[] =>
  opts.evaluations.flatMap(evaluation =>
    opts.models.map(model => {
      const runDirectory = join(opts.out, opts.skill, evaluation.id, model);
      const outputsDirectory = join(runDirectory, SkillEvalConstants.OUTPUTS_DIRECTORY);

      return {
        evaluation,
        model,
        runDirectory,
        outputsDirectory,
        command: buildRunCommand({ model, outputsDirectory, maxBudgetUsd: opts.maxBudgetUsd }),
      };
    }),
  );

/** A command as a shell line, for the plan: an empty or spaced argument is quoted. */
export const toCommandLine = (opts: { command: string[] }): string =>
  opts.command
    .map(part =>
      /^[A-Za-z0-9_./:=,@-]+$/.test(part) ? part : `'${part.replaceAll("'", "'\\''")}'`,
    )
    .join(' ');

/**
 * The skill reaches the model twice: SKILL.md inline, so every model surely has it, and the whole
 * skill directory installed in the copy, so the references SKILL.md links to resolve.
 */
export const buildRunPrompt = (opts: {
  skill: string;
  skillContent: string;
  evaluation: ISkillEval;
  outputsDirectory: string;
}): string =>
  [
    `<skill name="${opts.skill}">`,
    opts.skillContent.trim(),
    '</skill>',
    '',
    `Use the ${opts.skill} skill above for this task. Its files, references included, are installed at .claude/skills/${opts.skill}/.`,
    '',
    'Task:',
    opts.evaluation.prompt,
    '',
    ...(opts.evaluation.files.length > 0
      ? [`Input files: ${opts.evaluation.files.join(', ')}`]
      : []),
    `Output directory: ${opts.outputsDirectory}`,
    'The output path is that directory: write every file you produce there, named after its input file. Never edit the project files.',
  ].join('\n');

export const buildGraderPrompt = (opts: {
  evaluation: ISkillEval;
  outputs: { name: string; content: string }[];
}): string =>
  [
    'You grade one run of a skill eval. Judge only whether the output meets the expected output.',
    '',
    'The task the model was given:',
    opts.evaluation.prompt,
    '',
    'The expected output:',
    opts.evaluation.expectedOutput,
    '',
    'The files the model wrote:',
    ...opts.outputs.map(
      output => `<file name="${output.name}">\n${output.content.trimEnd()}\n</file>`,
    ),
    '',
    'Reply with only a JSON object, {"pass": boolean, "reasons": string[]}, most important reason first.',
  ].join('\n');

/** The fields of `claude -p --output-format json` this runner reads; anything unreadable is an error. */
export const readClaudeResponse = (opts: { stdout: string }): IClaudeResponse => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(opts.stdout);
  } catch {
    return { result: undefined, isError: true, costUsd: undefined, structuredOutput: undefined };
  }

  if (!isRecord(parsed)) {
    return { result: undefined, isError: true, costUsd: undefined, structuredOutput: undefined };
  }

  return {
    result: typeof parsed.result === 'string' ? parsed.result : undefined,
    isError: parsed.is_error === true,
    costUsd: typeof parsed.total_cost_usd === 'number' ? parsed.total_cost_usd : undefined,
    structuredOutput: parsed.structured_output,
  };
};

const toMalformed = (opts: { why: string }): IVerdict => ({
  pass: false,
  reasons: [`grader output is malformed: ${opts.why}`],
  isMalformed: true,
});

const toVerdict = (opts: { value: unknown }): IVerdict | undefined => {
  const value = opts.value;

  if (
    !isRecord(value) ||
    typeof value.pass !== 'boolean' ||
    !Array.isArray(value.reasons) ||
    !value.reasons.every(reason => typeof reason === 'string')
  ) {
    return undefined;
  }

  return { pass: value.pass, reasons: value.reasons, isMalformed: false };
};

/** The grader's verdict. Never throws: output that is not a verdict is a failed run, recorded. */
export const parseVerdict = (opts: { stdout: string }): IVerdict => {
  const response = readClaudeResponse({ stdout: opts.stdout });
  const structured = toVerdict({ value: response.structuredOutput });

  if (structured !== undefined) {
    return structured;
  }

  if (response.result === undefined) {
    return toMalformed({ why: 'no result in the claude response' });
  }

  const text = response.result
    .trim()
    .replace(/^```(?:json)?\s*/, '')
    .replace(/\s*```$/, '');
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch {
    return toMalformed({ why: `not JSON: ${text.slice(0, 80)}` });
  }

  return (
    toVerdict({ value }) ?? toMalformed({ why: 'needs {"pass": boolean, "reasons": string[]}' })
  );
};

export const toSeconds = (opts: { durationMs: number }): string =>
  `${(opts.durationMs / 1000).toFixed(1)}s`;

const toCell = (opts: { text: string }): string =>
  opts.text.replaceAll('|', '\\|').replaceAll('\n', ' ');

export const renderReport = (opts: {
  skill: string;
  grader: string;
  results: ISkillEvalResult[];
}): string => {
  const passed = opts.results.filter(result => result.verdict.pass).length;
  const costs = opts.results.flatMap(result =>
    result.costUsd === undefined ? [] : [result.costUsd],
  );
  const cost =
    costs.length === 0
      ? ''
      : ` Cost $${costs.reduce((sum, value) => sum + value, 0).toFixed(2)} (as claude reported it).`;
  const rows = opts.results.map(result => {
    const cells = [
      result.evalId,
      result.model,
      result.verdict.pass ? 'pass' : 'FAIL',
      toSeconds({ durationMs: result.durationMs }),
      toCell({ text: result.verdict.reasons[0] ?? '-' }),
    ];

    return `| ${cells.join(' | ')} |`;
  });

  return [
    `# Skill evals - ${opts.skill}`,
    '',
    '| Eval | Model | Result | Duration | First reason |',
    '|---|---|---|---|---|',
    ...rows,
    '',
    `**Passed ${passed} of ${opts.results.length}.** Graded by ${opts.grader}.${cost}`,
    '',
  ].join('\n');
};
