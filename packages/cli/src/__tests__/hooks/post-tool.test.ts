import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPostToolOutput } from '../../hooks/post-tool.ts';
import { buildPromptContract, buildStopOutput } from '../../hooks/index.ts';
import { readSignals } from '../../signals/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { spawnSyncBounded } from '../spawn.helper.ts';

afterAll(removeProjects);

const HOOKS = join(import.meta.dir, '..', '..', '..', 'base', 'hooks');
const LONG =
  'Everything is in order and nothing needs your attention right now, because the work is done and every check ran as expected today.';

/** A tool event; the wire names stay behind string-literal access. */
const toolEvent = (opts: {
  tool: string;
  input: Record<string, unknown>;
  isFailure?: boolean;
}): Record<string, unknown> => {
  const wire: Record<string, unknown> = {};

  wire['hook_event_name'] = opts.isFailure === true ? 'PostToolUseFailure' : 'PostToolUse';
  wire['tool_name'] = opts.tool;
  wire['tool_input'] = opts.input;

  return wire;
};

/** Wire-named inputs for the odd cases. */
const badTool = (): Record<string, unknown> => {
  const wire: Record<string, unknown> = {};

  wire['tool_name'] = 3;

  return wire;
};
const pathInput = (path: string): Record<string, unknown> => {
  const wire: Record<string, unknown> = {};

  wire['file_path'] = path;

  return wire;
};

const stopEvent = (text: string): Record<string, unknown> => {
  const wire: Record<string, unknown> = {};

  wire['last_assistant_message'] = text;

  return wire;
};

const project = (extra = ''): string => {
  const root = createProject({
    files: {
      '.configs/vulcan.config.ts': `export default { owner: { report: { enforce: 'advise', shortReplyWords: 0${extra} } } };\n`,
    },
  });

  mkdirSync(join(root, '.agents/local'), { recursive: true });

  return root;
};

const bash = (command: string, isFailure = false) =>
  toolEvent({ tool: 'Bash', input: { command }, isFailure });

describe('buildPostToolOutput', () => {
  test('says nothing for ordinary calls and for input it cannot read', () => {
    const root = project();

    expect(buildPostToolOutput({ projectRoot: root, input: bash('ls') })).toBeUndefined();

    for (const input of [null, 'x', {}, badTool()]) {
      expect(buildPostToolOutput({ projectRoot: root, input })).toBeUndefined();
    }
  });

  test('says the agent seems stuck on the third identical call, once per debounce window', () => {
    const root = project();
    const run = (now: number) =>
      buildPostToolOutput({ projectRoot: root, input: bash('bun test'), now });

    expect(run(1000)).toBeUndefined();
    expect(run(2000)).toBeUndefined();

    const third = run(3000);

    expect(JSON.stringify(third)).toContain('Loop check: the same Bash call 3 times in a row');
    expect(JSON.stringify(third)).toContain('"hookEventName":"PostToolUse"');
    expect(run(4000)).toBeUndefined();
    // Past the debounce window the same three calls, close together again, are said once more.
    const later = 3000 + 6 * 60 * 1000;

    run(later);
    run(later + 1000);

    expect(JSON.stringify(run(later + 2000))).toContain('Loop check');
  });

  test('a failure event counts failures: three in five calls is a loop, and the hook name says failure', () => {
    const root = project();
    const fail = (command: string, now: number) =>
      buildPostToolOutput({ projectRoot: root, input: bash(command, true), now });

    fail('make x', 1);
    buildPostToolOutput({ projectRoot: root, input: bash('ls'), now: 2 });
    fail('make x', 3);
    buildPostToolOutput({ projectRoot: root, input: bash('pwd'), now: 4 });

    const third = fail('make x', 5);

    expect(JSON.stringify(third)).toContain('"hookEventName":"PostToolUseFailure"');
    expect(JSON.stringify(third)).toContain('failing 3 times with the same input');
  });

  test('changing a skill or a rules file suggests the evals or the admission bar, once', () => {
    const root = project();
    const edit = (path: string) =>
      buildPostToolOutput({
        projectRoot: root,
        input: toolEvent({ tool: 'Edit', input: pathInput(path) }),
        now: 1,
      });

    expect(JSON.stringify(edit('/p/.agents/skills/ship/SKILL.md'))).toContain(
      'You changed the skill ship',
    );
    expect(edit('/p/.agents/skills/ship/SKILL.md')).toBeUndefined();
    expect(JSON.stringify(edit('/p/.agents/rules.md'))).toContain('rules file');
    expect(edit('/p/src/a.ts')).toBeUndefined();
  });
});

describe('the claims at Stop', () => {
  const classesLogged = (root: string): string => {
    const file = join(root, '.agents/local/violations.jsonl');

    return existsSync(file) ? readFileSync(file, 'utf8') : '';
  };

  test('"published" with no probe this turn is logged; after an npm view it is not', async () => {
    const root = project();

    await buildPromptContract({ projectRoot: root });
    await buildStopOutput({
      projectRoot: root,
      input: stopEvent(`${LONG} The package is published.`),
    });

    expect(classesLogged(root)).toContain('public-claim-no-probe');

    const probed = project();

    await buildPromptContract({ projectRoot: probed });
    buildPostToolOutput({ projectRoot: probed, input: bash('npm view @x/y version') });
    await buildStopOutput({
      projectRoot: probed,
      input: stopEvent(`${LONG} The package is published.`),
    });

    expect(classesLogged(probed)).not.toContain('public-claim-no-probe');
  });

  test('"all tests pass" after a failed test run this turn is contradicted, never blocks, and a short reply is checked too', async () => {
    const root = createProject({
      files: {
        '.configs/vulcan.config.ts':
          "export default { owner: { report: { enforce: 'block', shortReplyWords: 20 } } };\n",
      },
    });

    mkdirSync(join(root, '.agents/local'), { recursive: true });
    await buildPromptContract({ projectRoot: root });
    buildPostToolOutput({ projectRoot: root, input: bash('bun test', true) });

    expect(
      await buildStopOutput({ projectRoot: root, input: stopEvent('All tests pass.') }),
    ).toBeUndefined();
    expect(classesLogged(root)).toContain('contradicted-completion');
  });

  test('a new prompt forgets the last turn: a probe from before does not back a claim now', async () => {
    const root = project();

    buildPostToolOutput({ projectRoot: root, input: bash('npm view x version'), now: 1 });
    await buildPromptContract({ projectRoot: root });
    await buildStopOutput({ projectRoot: root, input: stopEvent(`${LONG} It is live.`) });

    expect(classesLogged(root)).toContain('public-claim-no-probe');
  });

  test('a project adds the words of its owner language', async () => {
    const root = project(", claimWords: { public: ['xuat ban'], done: [] }");

    await buildPromptContract({ projectRoot: root });
    await buildStopOutput({ projectRoot: root, input: stopEvent('Da xuat ban roi.') });

    expect(classesLogged(root)).toContain('public-claim-no-probe');
  });
});

const background = (): Record<string, unknown> => {
  const wire: Record<string, unknown> = {};

  wire['run_in_background'] = true;

  return wire;
};

describe('which gates failed', () => {
  const failedGatesOf = (root: string) => readSignals({ root, session: '' }).failedGates;

  test('a result with a non-zero exit code is a failure; a background command has no result yet', () => {
    const root = project();
    const withResponse = (
      command: string,
      response: Record<string, unknown>,
      extra: Record<string, unknown> = {},
    ) => {
      const wire = toolEvent({ tool: 'Bash', input: { command, ...extra } });

      wire['tool_response'] = response;

      return wire;
    };
    const exit = (code: number): Record<string, unknown> => {
      const response: Record<string, unknown> = {};

      response['exit_code'] = code;

      return response;
    };

    buildPostToolOutput({ projectRoot: root, input: withResponse('make lint', exit(2)) });
    buildPostToolOutput({
      projectRoot: root,
      input: withResponse('bun test', exit(1), background()),
    });

    expect(failedGatesOf(root)).toEqual(['make lint']);
  });

  test('a failed lint is still failed after a passing test run, until lint itself passes', () => {
    const root = project();

    buildPostToolOutput({ projectRoot: root, input: bash('make lint', true) });
    buildPostToolOutput({ projectRoot: root, input: bash('make test') });
    expect(failedGatesOf(root)).toEqual(['make lint']);

    buildPostToolOutput({ projectRoot: root, input: bash('make lint') });
    expect(failedGatesOf(root)).toEqual([]);
  });
});

describe('the post-tool hook file', () => {
  const run = (opts: { root: string; stdin: string; env?: Record<string, string> }) =>
    spawnSyncBounded({
      cmd: ['bun', join(HOOKS, 'post-tool.ts')],
      cwd: opts.root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: opts.root, ...opts.env },
      stdin: Buffer.from(opts.stdin),
    });

  test('prints the advisory as JSON, fails open on garbage without echoing it, and VULCAN_GUARDS=off is silent', () => {
    const root = project();
    const call = JSON.stringify(bash('bun test'));

    run({ root, stdin: call });
    run({ root, stdin: call });

    const third = run({ root, stdin: call });

    expect(JSON.parse(third.stdout.toString()).hookSpecificOutput.additionalContext).toContain(
      'Loop check',
    );

    const garbage = run({ root, stdin: '{ SECRETWORD' });

    expect(garbage.exitCode).toBe(0);
    expect(garbage.stderr.toString()).not.toContain('SECRETWORD');
    expect(
      run({ root: project(), stdin: call, env: { VULCAN_GUARDS: 'off' } }).stdout.toString(),
    ).toBe('');
  });
});
