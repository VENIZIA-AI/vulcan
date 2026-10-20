import { describe, expect, test } from 'bun:test';
import {
  buildGraderCommand,
  buildGraderPrompt,
  buildPlan,
  buildRunCommand,
  buildRunPrompt,
  parseEvalsFile,
  parseSkillEvalArgs,
  parseVerdict,
  readClaudeResponse,
  renderReport,
  toCommandLine,
} from '../skill-evals-core.ts';

const EVALUATION = {
  id: '0',
  prompt: 'Rewrite docs/page.md. Save it to the output path given.',
  expectedOutput: 'A shorter, scannable page',
  files: ['docs/page.md'],
};

describe('parseSkillEvalArgs', () => {
  test('defaults: three models, opus grades, 900 s, no project or out, runs for real', () => {
    expect(parseSkillEvalArgs({ args: ['--skill', 'docs-writing'] })).toEqual({
      skill: 'docs-writing',
      models: ['haiku', 'sonnet', 'opus'],
      grader: 'opus',
      project: undefined,
      out: undefined,
      timeoutSeconds: 900,
      maxBudgetUsd: undefined,
      isDryRun: false,
    });
  });

  test('--max-budget-usd caps every claude call, and takes a positive amount only', () => {
    expect(
      parseSkillEvalArgs({ args: ['--skill', 'docs-writing', '--max-budget-usd', '2.5'] })
        .maxBudgetUsd,
    ).toBe('2.5');
    expect(() =>
      parseSkillEvalArgs({ args: ['--skill', 'docs-writing', '--max-budget-usd', 'lots'] }),
    ).toThrow('--max-budget-usd needs a dollar amount above 0, got: lots');
    expect(
      buildRunCommand({ model: 'haiku', outputsDirectory: '/o', maxBudgetUsd: '2.5' }).slice(-2),
    ).toEqual(['--max-budget-usd', '2.5']);
    expect(buildGraderCommand({ grader: 'opus', maxBudgetUsd: '2.5' }).slice(-2)).toEqual([
      '--max-budget-usd',
      '2.5',
    ]);
  });

  test('every flag and its value are read', () => {
    const parsed = parseSkillEvalArgs({
      args: [
        '--skill',
        'docs-writing',
        '--models',
        'haiku, sonnet',
        '--grader',
        'sonnet',
        '--project',
        '../ignis',
        '--out',
        '/tmp/evals',
        '--timeout',
        '30',
        '--max-budget-usd',
        '3',
        '--dry-run',
      ],
    });

    expect(parsed).toEqual({
      skill: 'docs-writing',
      models: ['haiku', 'sonnet'],
      grader: 'sonnet',
      project: '../ignis',
      out: '/tmp/evals',
      timeoutSeconds: 30,
      maxBudgetUsd: '3',
      isDryRun: true,
    });
  });

  test('no --skill throws', () => {
    expect(() => parseSkillEvalArgs({ args: [] })).toThrow('--skill <name> is required');
  });

  test('a skill name that is not a plain directory name throws', () => {
    expect(() => parseSkillEvalArgs({ args: ['--skill', '../rules'] })).toThrow(
      "--skill '../rules' is not a skill name",
    );
  });

  test('a model name that cannot be a directory throws', () => {
    expect(() => parseSkillEvalArgs({ args: ['--skill', 'x', '--models', 'haiku,a/b'] })).toThrow(
      "--models 'a/b' is not a model name",
    );
  });

  test('a timeout that is not a positive whole number throws', () => {
    expect(() => parseSkillEvalArgs({ args: ['--skill', 'x', '--timeout', '0'] })).toThrow(
      '--timeout needs whole seconds above 0, got: 0',
    );
  });

  test('a flag without its value throws', () => {
    expect(() => parseSkillEvalArgs({ args: ['--skill'] })).toThrow('--skill needs a value');
  });

  test('an unknown argument throws instead of being ignored', () => {
    expect(() => parseSkillEvalArgs({ args: ['--skill', 'x', '--dryrun'] })).toThrow(
      "unknown argument '--dryrun'",
    );
  });
});

describe('parseEvalsFile', () => {
  test('reads skill-creator evals.json, ids as strings, files default to none', () => {
    const text = JSON.stringify({
      skill_name: 'docs-writing',
      evals: [
        { id: 0, prompt: 'p0', expected_output: 'e0', files: ['a.md'] },
        { id: 'short', prompt: 'p1', expected_output: 'e1' },
      ],
    });

    expect(parseEvalsFile({ text, skill: 'docs-writing' })).toEqual([
      { id: '0', prompt: 'p0', expectedOutput: 'e0', files: ['a.md'] },
      { id: 'short', prompt: 'p1', expectedOutput: 'e1', files: [] },
    ]);
  });

  test('not JSON throws', () => {
    expect(() => parseEvalsFile({ text: '{', skill: 'x' })).toThrow('is not JSON');
  });

  test('an eval without a prompt or expected_output throws, naming its index', () => {
    const text = JSON.stringify({ skill_name: 'x', evals: [{ id: 0, prompt: 'p' }] });

    expect(() => parseEvalsFile({ text, skill: 'x' })).toThrow(
      'evals[0] needs id, prompt and expected_output',
    );
  });

  test('an id that cannot be a directory name throws', () => {
    const text = JSON.stringify({
      skill_name: 'x',
      evals: [{ id: '../up', prompt: 'p', expected_output: 'e' }],
    });

    expect(() => parseEvalsFile({ text, skill: 'x' })).toThrow("evals[0] id '../up'");
  });

  test('a skill_name for another skill throws', () => {
    const text = JSON.stringify({ skill_name: 'other', evals: [] });

    expect(() => parseEvalsFile({ text, skill: 'x' })).toThrow(
      "skill_name is 'other', expected 'x'",
    );
  });

  test('no evals throws', () => {
    const text = JSON.stringify({ skill_name: 'x', evals: [] });

    expect(() => parseEvalsFile({ text, skill: 'x' })).toThrow('has no evals');
  });
});

describe('buildPlan', () => {
  test('one run per eval x model, each in <out>/<skill>/<eval-id>/<model>/', () => {
    const plan = buildPlan({
      skill: 'docs-writing',
      evaluations: [EVALUATION, { ...EVALUATION, id: '1' }],
      models: ['haiku', 'opus'],
      out: '/tmp/out',
    });

    expect(plan.map(run => `${run.evaluation.id}/${run.model} ${run.runDirectory}`)).toEqual([
      '0/haiku /tmp/out/docs-writing/0/haiku',
      '0/opus /tmp/out/docs-writing/0/opus',
      '1/haiku /tmp/out/docs-writing/1/haiku',
      '1/opus /tmp/out/docs-writing/1/opus',
    ]);
    expect(plan[0].outputsDirectory).toBe('/tmp/out/docs-writing/0/haiku/outputs');
    expect(plan[0].command).toEqual(
      buildRunCommand({
        model: 'haiku',
        outputsDirectory: '/tmp/out/docs-writing/0/haiku/outputs',
      }),
    );
  });
});

describe('buildRunCommand / buildGraderCommand', () => {
  test('the run: print mode, JSON, edits accepted, nothing prompts, the outputs directory allowed', () => {
    expect(buildRunCommand({ model: 'haiku', outputsDirectory: '/o' })).toEqual([
      'claude',
      '-p',
      '--model',
      'haiku',
      '--output-format',
      'json',
      '--permission-mode',
      'acceptEdits',
      '--permission-prompts',
      'none',
      '--no-session-persistence',
      '--add-dir',
      '/o',
    ]);
  });

  test('the grader: no tools, a JSON schema for the verdict', () => {
    const command = buildGraderCommand({ grader: 'opus' });

    expect(command.slice(0, 6)).toEqual([
      'claude',
      '-p',
      '--model',
      'opus',
      '--output-format',
      'json',
    ]);
    expect(command[command.indexOf('--tools') + 1]).toBe('');
    expect(JSON.parse(command[command.indexOf('--json-schema') + 1]).required).toEqual([
      'pass',
      'reasons',
    ]);
  });

  test('toCommandLine quotes what a shell would split or drop', () => {
    expect(toCommandLine({ command: ['claude', '--tools', '', '--add-dir', '/a b'] })).toBe(
      "claude --tools '' --add-dir '/a b'",
    );
  });
});

describe('buildRunPrompt / buildGraderPrompt', () => {
  test('the run prompt carries the skill, where it is installed, the task and the output directory', () => {
    const prompt = buildRunPrompt({
      skill: 'docs-writing',
      skillContent: '# Docs writing\nShort sentences.',
      evaluation: EVALUATION,
      outputsDirectory: '/o',
    });

    expect(prompt).toContain(
      '<skill name="docs-writing">\n# Docs writing\nShort sentences.\n</skill>',
    );
    expect(prompt).toContain('.claude/skills/docs-writing/');
    expect(prompt).toContain(EVALUATION.prompt);
    expect(prompt).toContain('Input files: docs/page.md');
    expect(prompt).toMatch(/^Output directory: \/o$/m);
  });

  test('the grader prompt carries the task, the expected output and every output file', () => {
    const prompt = buildGraderPrompt({
      evaluation: EVALUATION,
      outputs: [{ name: 'page.md', content: '# Page' }],
    });

    expect(prompt).toContain(EVALUATION.prompt);
    expect(prompt).toContain(EVALUATION.expectedOutput);
    expect(prompt).toContain('<file name="page.md">\n# Page\n</file>');
    expect(prompt).toContain('{"pass": boolean, "reasons": string[]}');
  });
});

describe('readClaudeResponse', () => {
  test('reads result, is_error, total_cost_usd and structured_output', () => {
    const stdout = JSON.stringify({
      type: 'result',
      is_error: false,
      result: 'done',
      total_cost_usd: 0.25,
      structured_output: { pass: true, reasons: [] },
    });

    expect(readClaudeResponse({ stdout })).toEqual({
      result: 'done',
      isError: false,
      costUsd: 0.25,
      structuredOutput: { pass: true, reasons: [] },
    });
  });

  test('stdout that is not JSON is an error response, not a throw', () => {
    expect(readClaudeResponse({ stdout: 'oops' })).toEqual({
      result: undefined,
      isError: true,
      costUsd: undefined,
      structuredOutput: undefined,
    });
  });
});

describe('parseVerdict', () => {
  const respond = (fields: object): string =>
    JSON.stringify({ type: 'result', is_error: false, ...fields });

  test('structured_output wins when it is a verdict', () => {
    expect(
      parseVerdict({ stdout: respond({ structured_output: { pass: true, reasons: ['tight'] } }) }),
    ).toEqual({ pass: true, reasons: ['tight'], isMalformed: false });
  });

  test('a verdict in the result text, fenced or bare, is read', () => {
    const fenced = respond({ result: '```json\n{"pass": false, "reasons": ["too long"]}\n```' });

    expect(parseVerdict({ stdout: fenced })).toEqual({
      pass: false,
      reasons: ['too long'],
      isMalformed: false,
    });
  });

  test('prose instead of a verdict is a recorded failure, never a throw', () => {
    const verdict = parseVerdict({ stdout: respond({ result: 'It passes, mostly.' }) });

    expect(verdict.pass).toBe(false);
    expect(verdict.isMalformed).toBe(true);
    expect(verdict.reasons[0]).toStartWith('grader output is malformed');
  });

  test('a verdict with the wrong shape is malformed', () => {
    const verdict = parseVerdict({
      stdout: respond({ result: '{"pass": "yes", "reasons": "ok"}' }),
    });

    expect(verdict).toEqual({
      pass: false,
      reasons: ['grader output is malformed: needs {"pass": boolean, "reasons": string[]}'],
      isMalformed: true,
    });
  });

  test('stdout that is not a claude response at all is malformed', () => {
    expect(parseVerdict({ stdout: '' }).isMalformed).toBe(true);
  });
});

describe('renderReport', () => {
  test('one row per eval x model, the first reason, and the totals', () => {
    const report = renderReport({
      skill: 'docs-writing',
      grader: 'opus',
      results: [
        {
          evalId: '0',
          model: 'haiku',
          durationMs: 1500,
          costUsd: 0.1,
          verdict: { pass: true, reasons: ['scannable', 'short'], isMalformed: false },
        },
        {
          evalId: '0',
          model: 'opus',
          durationMs: 62_000,
          costUsd: undefined,
          verdict: { pass: false, reasons: ['kept | the walls'], isMalformed: false },
        },
      ],
    });

    expect(report).toContain('# Skill evals - docs-writing');
    expect(report).toContain('| Eval | Model | Result | Duration | First reason |');
    expect(report).toContain('| 0 | haiku | pass | 1.5s | scannable |');
    expect(report).toContain('| 0 | opus | FAIL | 62.0s | kept \\| the walls |');
    expect(report).toContain(
      '**Passed 1 of 2.** Graded by opus. Cost $0.10 (as claude reported it).',
    );
  });
});
