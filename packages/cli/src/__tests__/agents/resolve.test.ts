import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LOCAL_AGENTS_FILE,
  NO_TTY_HINT,
  renderLocalChoice,
  resolveAgents,
} from '../../agents/index.ts';
import { renderAgentsQuestion } from '../../agents/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const NOTHING_DETECTED = { detected: [] as string[] };

const resolve = (opts: {
  files?: Record<string, string>;
  flag?: string;
  configAgents?: string[];
  interactive?: boolean;
  answer?: string | null;
  detected?: string[];
}) => {
  const root = createProject({ files: opts.files ?? {} });
  const asked: { detected: string[]; stored: string[] | undefined }[] = [];
  const result = resolveAgents({
    root,
    flag: opts.flag,
    configAgents: opts.configAgents,
    interactive: opts.interactive ?? false,
    detected: opts.detected ?? NOTHING_DETECTED.detected,
    ask: (question) => {
      asked.push(question);

      return opts.answer === undefined ? '' : opts.answer;
    },
  });

  return { result, asked, root };
};

describe('resolveAgents: the order', () => {
  test('a flag wins over everything and is written to the local file', () => {
    const { result } = resolve({
      flag: 'omp,pi',
      files: {
        [LOCAL_AGENTS_FILE]: renderLocalChoice({ agents: ['claude'] }),
        'CLAUDE.md': '@AGENTS.md\n',
      },
      configAgents: ['cursor'],
    });

    expect(result).toEqual({
      ok: true,
      agents: ['omp', 'pi'],
      source: 'flag',
      writeLocal: true,
      hint: undefined,
    });
  });

  test('none is an empty list', () => {
    expect(resolve({ flag: 'none' }).result).toMatchObject({
      ok: true,
      agents: [],
      source: 'flag',
      writeLocal: true,
    });
  });

  test('the local file wins over migration and config, and is not rewritten', () => {
    const { result } = resolve({
      files: {
        [LOCAL_AGENTS_FILE]: renderLocalChoice({ agents: ['omp'] }),
        'CLAUDE.md': '@AGENTS.md\n',
      },
      configAgents: ['cursor'],
    });

    expect(result).toMatchObject({ ok: true, agents: ['omp'], source: 'local', writeLocal: false });
  });

  test('a project with CLAUDE.md is treated as claude, and the choice is stored', () => {
    expect(resolve({ files: { 'CLAUDE.md': '@AGENTS.md\n' } }).result).toMatchObject({
      ok: true,
      agents: ['claude'],
      source: 'migration',
      writeLocal: true,
      hint: undefined,
    });
  });

  test('a .claude folder alone is the same signal', () => {
    const root = createProject({ files: {} });

    mkdirSync(join(root, '.claude'));
    writeFileSync(join(root, '.claude', 'settings.json'), '{}');

    expect(
      resolveAgents({
        root,
        flag: undefined,
        configAgents: undefined,
        interactive: false,
        detected: [],
        ask: () => '',
      }),
    ).toMatchObject({ ok: true, agents: ['claude'], source: 'migration' });
  });

  test('the committed config agents are the suggested default when the machine has no choice', () => {
    expect(resolve({ configAgents: ['claude', 'omp'] }).result).toMatchObject({
      ok: true,
      agents: ['claude', 'omp'],
      source: 'config',
      writeLocal: true,
    });
  });
});

describe('resolveAgents: nothing known', () => {
  test('without a terminal it keeps today: claude, one hint line, no local file written', () => {
    const { result, asked } = resolve({ interactive: false });

    expect(result).toEqual({
      ok: true,
      agents: ['claude'],
      source: 'default',
      writeLocal: false,
      hint: NO_TTY_HINT,
    });
    expect(NO_TTY_HINT).toBe(
      'vulcan sync: no agents chosen on this machine - wrote the Claude files as before; to choose, run: vulcan sync --agents claude,omp (or none)',
    );
    expect(asked).toEqual([]);
  });

  test('in a terminal it asks, offering what it detected, and stores the answer', () => {
    const { result, asked } = resolve({
      interactive: true,
      detected: ['claude', 'omp'],
      answer: 'omp, pi',
    });

    expect(asked).toEqual([{ detected: ['claude', 'omp'], stored: undefined }]);
    expect(result).toMatchObject({
      ok: true,
      agents: ['omp', 'pi'],
      source: 'asked',
      writeLocal: true,
    });
  });

  test('an empty answer accepts the detected agents', () => {
    expect(
      resolve({ interactive: true, detected: ['claude', 'cursor'], answer: '' }).result,
    ).toMatchObject({
      ok: true,
      agents: ['claude', 'cursor'],
      source: 'asked',
    });
  });

  test('an empty answer with nothing detected is an empty choice, none', () => {
    expect(resolve({ interactive: true, detected: [], answer: '' }).result).toMatchObject({
      ok: true,
      agents: [],
      source: 'asked',
    });
  });

  test('end of input (null) in a terminal stops without writing', () => {
    expect(resolve({ interactive: true, answer: null }).result).toEqual({
      ok: false,
      error: 'vulcan sync: no answer - run: vulcan sync --agents claude,omp (or none)',
    });
  });

  test('--agents with no value re-asks, showing the stored choice', () => {
    const { result, asked } = resolve({
      flag: '',
      interactive: true,
      detected: ['claude'],
      files: { [LOCAL_AGENTS_FILE]: renderLocalChoice({ agents: ['omp'] }) },
      answer: 'omp,codex',
    });

    expect(asked).toEqual([{ detected: ['claude'], stored: ['omp'] }]);
    expect(result).toMatchObject({
      ok: true,
      agents: ['omp', 'codex'],
      source: 'asked',
      writeLocal: true,
    });
  });

  test('--agents with no value and no terminal is an error that names the flag', () => {
    expect(resolve({ flag: '', interactive: false }).result).toEqual({
      ok: false,
      error: 'vulcan sync: --agents needs a list (claude,omp) or none',
    });
  });
});

describe('resolveAgents: refusals', () => {
  test('an unknown id in the flag, the answer or the config is refused, naming it and the choices', () => {
    const flag = resolve({ flag: 'claude,vim' }).result;
    const answer = resolve({ interactive: true, answer: 'vim' }).result;

    expect(!flag.ok && flag.error).toBe(
      "vulcan sync: unknown agent 'vim' - one of: claude, omp, codex, cursor, copilot-cli, copilot-vscode, antigravity, pi, none",
    );
    expect(!answer.ok && answer.error).toContain("unknown agent 'vim'");
  });

  test('none cannot be mixed with agents', () => {
    expect(resolve({ flag: 'none,claude' }).result).toEqual({
      ok: false,
      error: "vulcan sync: 'none' cannot be combined with other agents",
    });
  });

  test('duplicates collapse, the table order is kept', () => {
    expect(resolve({ flag: 'pi,claude,pi' }).result).toMatchObject({
      ok: true,
      agents: ['claude', 'pi'],
    });
  });

  test('a broken local file is an error, not a silent default', () => {
    const { result } = resolve({ files: { [LOCAL_AGENTS_FILE]: '{ nope' } });

    expect(!result.ok && result.error).toContain('is not valid JSON');
  });
});

describe('resolveAgents: what Enter (an empty answer) does when asked again', () => {
  const STORED = { [LOCAL_AGENTS_FILE]: renderLocalChoice({ agents: ['claude', 'omp'] }) };
  const DETECTED = ['claude', 'omp', 'codex', 'copilot-vscode'];

  test('a stored choice is kept, not replaced by what was detected', () => {
    const { result } = resolve({
      files: STORED,
      flag: '',
      interactive: true,
      answer: '',
      detected: DETECTED,
    });

    expect(result).toMatchObject({
      ok: true,
      agents: ['claude', 'omp'],
      source: 'asked',
      writeLocal: true,
    });
  });

  test('a stored empty choice (none) is kept too', () => {
    const { result } = resolve({
      files: { [LOCAL_AGENTS_FILE]: renderLocalChoice({ agents: [] }) },
      flag: '',
      interactive: true,
      answer: '',
      detected: DETECTED,
    });

    expect(result).toMatchObject({ ok: true, agents: [], source: 'asked' });
  });

  test('with nothing stored, Enter takes the detected list', () => {
    const { result } = resolve({ interactive: true, answer: '', detected: DETECTED });

    expect(result).toMatchObject({ ok: true, agents: DETECTED, source: 'asked', writeLocal: true });
  });

  test('an explicit list replaces the stored one', () => {
    const { result } = resolve({
      files: STORED,
      flag: '',
      interactive: true,
      answer: 'omp,pi',
      detected: DETECTED,
    });

    expect(result).toMatchObject({ ok: true, agents: ['omp', 'pi'], source: 'asked' });
  });

  test('none, typed, empties the list', () => {
    const { result } = resolve({
      files: STORED,
      flag: '',
      interactive: true,
      answer: 'none',
      detected: DETECTED,
    });

    expect(result).toMatchObject({ ok: true, agents: [], source: 'asked' });
  });
});

describe('the agents question says what Enter does', () => {
  test('with a stored choice: Enter keeps it, and it is shown', () => {
    const text = renderAgentsQuestion({ detected: ['claude', 'codex'], stored: ['claude', 'omp'] });

    expect(text).toContain('Enter keeps your earlier choice: claude, omp');
    expect(text).toContain('  chosen before: claude, omp');
    expect(text).not.toContain('Enter accepts');
  });

  test('a stored empty choice reads none', () => {
    expect(renderAgentsQuestion({ detected: ['claude'], stored: [] })).toContain(
      'Enter keeps your earlier choice: none',
    );
  });

  test('with nothing stored: Enter takes the detected list', () => {
    const text = renderAgentsQuestion({ detected: ['claude', 'codex'], stored: undefined });

    expect(text).toContain('Enter accepts the detected list: claude, codex');
    expect(text).not.toContain('chosen before');
  });

  test('with nothing stored and nothing detected, Enter gives none', () => {
    expect(renderAgentsQuestion({ detected: [], stored: undefined })).toContain(
      'Enter accepts the detected list: none',
    );
  });
});
