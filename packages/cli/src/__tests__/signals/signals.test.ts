import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  appendSignal,
  callKeyOf,
  checkClaims,
  ClaimClasses,
  EntryKinds,
  gatesOf,
  isPublicProbe,
  loopOf,
  readSignals,
  startTurn,
  watchedFileOf,
} from '../../signals/index.ts';
import type { ISignalEvent, ISignalState } from '../../signals/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const event = (opts: {
  tool: string;
  input: unknown;
  isOk?: boolean;
  at?: number;
}): ISignalEvent => ({
  tool: opts.tool,
  key: callKeyOf({ tool: opts.tool, input: opts.input }),
  isOk: opts.isOk ?? true,
  at: opts.at ?? 1,
});

describe('a command that asks public state', () => {
  test.each([
    'npm view @venizia/vulcan version',
    'gh pr view 12 --json state',
    'gh run watch 4010',
    'gh repo view owner/name',
    'gh api repos/o/r/pulls/1',
    'git ls-remote origin develop',
    'curl -sI https://registry.npmjs.org/x',
  ])('%s is a probe', (command) => {
    expect(isPublicProbe({ command })).toBe(true);
  });

  test.each([
    'ls',
    'git status',
    'gh --version',
    'echo curl x',
    'which curl',
    'git commit -m "run npm view later"',
    'cat <<EOF\nnpm view x\nEOF',
    'curl http://localhost:3000/health',
    'curl -X POST https://example.com/hook',
    'gh pr create --title x',
    'gh issue create --title x',
    'gh api -X POST repos/o/r/issues',
    'gh api repos/o/r/issues -f title=x',
  ])('%s is not', (command) => {
    expect(isPublicProbe({ command })).toBe(false);
  });
});

describe('the gates a command runs', () => {
  test.each([
    'bun test',
    'bun test src/a.test.ts',
    'bun run lint',
    'bun run build',
    'bun run typecheck',
    'bunx eslint .',
    'npx jest',
    'vitest run',
    'make test',
    'make lint-all',
    'make typecheck',
    'bun x --no-install vulcan doctor',
    'npm run test',
    'tsc --noEmit',
    'cd app && bun test',
    'bun test | tail -5',
  ])('%s is a gate', (command) => {
    expect(gatesOf({ command }).length).toBeGreaterThan(0);
  });

  test.each([
    'ls -la',
    'git status',
    'git commit -m "fix tsc errors"',
    'grep -rn "bun test" .',
    'cat tsc.log',
    'echo make lint',
    'bun run dev',
    'make help',
  ])('%s is not', (command) => {
    expect(gatesOf({ command })).toEqual([]);
  });
});

describe('the files that are watched', () => {
  test('a skill, its references and evals, and a rules file; nothing else', () => {
    expect(watchedFileOf({ path: '/p/.agents/skills/ship/SKILL.md' })).toEqual({
      kind: 'skill',
      name: 'ship',
    });
    expect(watchedFileOf({ path: '/p/packages/cli/base/skills/retro/references/x.md' })).toEqual({
      kind: 'skill',
      name: 'retro',
    });
    expect(watchedFileOf({ path: '/p/.agents/skills/ship/evals/evals.json' })).toEqual({
      kind: 'skill',
      name: 'ship',
    });
    expect(watchedFileOf({ path: '/p/.agents/rules.md' })?.kind).toBe('rules');
    expect(watchedFileOf({ path: '/p/src/a.ts' })).toBeUndefined();
    expect(watchedFileOf({ path: '/p/docs/wiki/content/skills/ship/SKILL.md' })).toBeUndefined();
    expect(watchedFileOf({ path: '/p/.agents/local/tmp/skills/x/SKILL.md' })).toBeUndefined();
  });

  test('the same input has the same key, a different one a different key', () => {
    expect(callKeyOf({ tool: 'Bash', input: { command: 'ls' } })).toBe(
      callKeyOf({ tool: 'Bash', input: { command: 'ls' } }),
    );
    expect(callKeyOf({ tool: 'Bash', input: { command: 'ls' } })).not.toBe(
      callKeyOf({ tool: 'Bash', input: { command: 'pwd' } }),
    );
  });
});

describe('loopOf', () => {
  test('the same call three times in a row within a minute; polling further apart is not a loop', () => {
    const call = (at: number) => event({ tool: 'Bash', input: { command: 'bun test' }, at });

    expect(loopOf({ events: [call(1000), call(2000), call(3000)] })).toContain('3 times in a row');
    expect(loopOf({ events: [call(1000), call(2000)] })).toBeUndefined();
    expect(loopOf({ events: [call(0), call(120_000), call(240_000)] })).toBeUndefined();
  });

  test('two calls alternating for three rounds; comparing two files once is not a loop', () => {
    const first = event({ tool: 'Read', input: 'a' });
    const second = event({ tool: 'Edit', input: 'a' });

    expect(loopOf({ events: [first, second, first, second, first, second] })).toContain(
      'alternating',
    );
    expect(loopOf({ events: [first, second, first, second] })).toBeUndefined();
  });

  test('one call failing three times with the same input; different failing calls are ordinary work', () => {
    const same = event({ tool: 'Bash', input: 'make x', isOk: false });
    const other = event({ tool: 'Read', input: 'a' });
    const fail = (input: string) => event({ tool: 'Bash', input, isOk: false });

    expect(loopOf({ events: [same, other, same, other, same] })).toContain(
      'failing 3 times with the same input',
    );
    expect(loopOf({ events: [fail('a'), other, fail('b'), other, fail('c')] })).toBeUndefined();
  });

  test('ordinary work is not a loop', () => {
    expect(
      loopOf({
        events: [
          event({ tool: 'Read', input: 1 }),
          event({ tool: 'Edit', input: 2 }),
          event({ tool: 'Bash', input: 3 }),
          event({ tool: 'Read', input: 4 }),
        ],
      }),
    ).toBeUndefined();
  });
});

describe('checkClaims', () => {
  const state = (change: Partial<ISignalState> = {}): ISignalState => ({
    turnAt: 100,
    events: [],
    probeAt: 0,
    failedGates: [],
    editAt: 0,
    notedAt: {},
    ...change,
  });
  const failed = state({ failedGates: ['make lint'] });

  test('"published" without a probe this turn is flagged; with one it is not', () => {
    expect(checkClaims({ text: 'The package is published.', state: state() })).toEqual([
      ClaimClasses.PUBLIC_CLAIM_NO_PROBE,
    ]);
    expect(
      checkClaims({ text: 'The package is published.', state: state({ probeAt: 150 }) }),
    ).toEqual([]);
    expect(
      checkClaims({ text: 'The package is published.', state: state({ probeAt: 50 }) }),
    ).toEqual([ClaimClasses.PUBLIC_CLAIM_NO_PROBE]);
  });

  test('"all tests pass" while a gate of the turn still fails is contradicted', () => {
    expect(checkClaims({ text: 'All tests pass.', state: failed })).toEqual([
      ClaimClasses.CONTRADICTED_COMPLETION,
    ]);
    expect(checkClaims({ text: 'All tests pass.', state: state() })).toEqual([]);
    expect(checkClaims({ text: 'I looked at it.', state: failed })).toEqual([]);
  });

  test.each([
    'It is unreleased.',
    'Nothing was published yet.',
    'The package was unpublished.',
    'I republished nothing.',
    'You asked whether it was released; I have not checked.',
    'Was it released?',
    "It isn't deployed.",
    'Do not say it is live until the probe ran.',
    'This live preview is up.',
    'It depends on npm for the install.',
    '> It was released last week.',
    'See `published` in the log.',
    'I will tell you when it is released.',
  ])('an honest or unrelated sentence is not a claim: %s', (text) => {
    expect(checkClaims({ text, state: state() })).toEqual([]);
  });

  test.each([
    'Not all green: lint failed.',
    'I did not say all tests pass.',
    'Tests passed before the change, but lint failed.',
  ])('a denial is not a completion claim: %s', (text) => {
    expect(checkClaims({ text, state: failed })).toEqual([]);
  });

  test('a claim in the middle of a longer reply is found, and a project adds its words, normalised', () => {
    expect(
      checkClaims({
        text: 'I checked the diff.\n\nThe release is published on the registry.',
        state: state(),
      }),
    ).toEqual([ClaimClasses.PUBLIC_CLAIM_NO_PROBE]);
    expect(
      checkClaims({ text: 'Đã xuất bản rồi.', state: state(), publicWords: ['xuất bản'] }),
    ).toEqual([ClaimClasses.PUBLIC_CLAIM_NO_PROBE]);
    expect(
      checkClaims({
        text: 'Đã xuất bản rồi.'.normalize('NFD'),
        state: state(),
        publicWords: ['xuất bản'],
      }),
    ).toEqual([ClaimClasses.PUBLIC_CLAIM_NO_PROBE]);
  });
});

describe('the log of a turn', () => {
  const project = (): string => {
    const root = createProject({ files: {} });

    mkdirSync(join(root, '.agents/local'), { recursive: true });

    return root;
  };
  const call = (opts: {
    session: string;
    at: number;
    isOk?: boolean;
    gates?: string[];
    isProbe?: boolean;
    agent?: string;
  }) => ({
    kind: EntryKinds.CALL,
    session: opts.session,
    agent: opts.agent ?? '',
    at: opts.at,
    tool: 'Bash',
    key: 'Bash:x',
    isOk: opts.isOk ?? true,
    isProbe: opts.isProbe ?? false,
    gates: opts.gates ?? [],
    isEdit: false,
  });

  test('is folded per session from its last prompt: a turn of another session changes nothing here', () => {
    const root = project();

    startTurn({ root, session: 'a', now: 10 });
    appendSignal({ root, entry: call({ session: 'a', at: 20, isProbe: true }) });
    startTurn({ root, session: 'b', now: 30 });
    appendSignal({ root, entry: call({ session: 'b', at: 40 }) });

    expect(readSignals({ root, session: 'a' })).toMatchObject({ turnAt: 10, probeAt: 20 });
    expect(readSignals({ root, session: 'b' })).toMatchObject({ turnAt: 30, probeAt: 0 });

    startTurn({ root, session: 'a', now: 50 });

    expect(readSignals({ root, session: 'a' })).toMatchObject({
      turnAt: 50,
      probeAt: 0,
      events: [],
    });
  });

  test('a gate counts as failed until its own latest run passes, whichever gate ran last', () => {
    const root = project();

    startTurn({ root, session: 'a', now: 1 });
    appendSignal({ root, entry: call({ session: 'a', at: 2, isOk: false, gates: ['make lint'] }) });
    appendSignal({ root, entry: call({ session: 'a', at: 3, gates: ['make test'] }) });

    expect(readSignals({ root, session: 'a' }).failedGates).toEqual(['make lint']);

    appendSignal({ root, entry: call({ session: 'a', at: 4, gates: ['make lint'] }) });

    expect(readSignals({ root, session: 'a' }).failedGates).toEqual([]);
  });

  test('events can be narrowed to one agent while a probe or gate of any agent still counts', () => {
    const root = project();

    startTurn({ root, session: 'a', now: 1 });
    appendSignal({ root, entry: call({ session: 'a', at: 2, agent: 'sub', isProbe: true }) });
    appendSignal({ root, entry: call({ session: 'a', at: 3 }) });

    const main = readSignals({ root, session: 'a', agent: '' });

    expect(main.events).toHaveLength(1);
    expect(main.probeAt).toBe(2);
  });

  test('parallel appends lose nothing', async () => {
    const root = project();

    startTurn({ root, session: 'a', now: 1 });
    await Promise.all(
      Array.from({ length: 40 }, async (_, index) => {
        appendSignal({ root, entry: call({ session: 'a', at: 2 + index }) });
      }),
    );

    expect(readSignals({ root, session: 'a' }).events).toHaveLength(30);
    expect(
      readFileSync(join(root, '.agents/local/cache/signals.jsonl'), 'utf8').trim().split('\n'),
    ).toHaveLength(41);
  });

  test('a log past its size is cut at a new turn to what still matters', () => {
    const root = project();

    startTurn({ root, session: 'a', now: 1 });

    for (let index = 0; index < 600; index += 1) {
      appendSignal({ root, entry: call({ session: 'a', at: 2 + index }) });
    }

    startTurn({ root, session: 'a', now: 10 * 60 * 1000 });

    expect(
      readFileSync(join(root, '.agents/local/cache/signals.jsonl'), 'utf8').trim().split('\n')
        .length,
    ).toBeLessThan(5);
  });

  test('a damaged log reads as empty; nothing is written without .agents/local/; a symlinked cache or file is not followed', () => {
    const root = project();
    const none = createProject({ files: {} });
    const linked = project();
    const outside = createProject({ files: {} });
    const file = createProject({ files: { 'victim.txt': 'keep' } });

    mkdirSync(join(root, '.agents/local/cache'), { recursive: true });
    writeFileSync(join(root, '.agents/local/cache/signals.jsonl'), '{ nope\n{"kind":3}\n');
    expect(readSignals({ root, session: 'a' }).events).toEqual([]);

    startTurn({ root: none, session: 'a' });
    expect(() => readFileSync(join(none, '.agents/local/cache/signals.jsonl'))).toThrow();

    symlinkSync(outside, join(linked, '.agents/local/cache'));
    startTurn({ root: linked, session: 'a' });
    appendSignal({ root: linked, entry: call({ session: 'a', at: 1 }) });
    expect(() => readFileSync(join(outside, 'signals.jsonl'))).toThrow();

    mkdirSync(join(file, '.agents/local/cache'), { recursive: true });
    symlinkSync(join(file, 'victim.txt'), join(file, '.agents/local/cache/signals.jsonl'));
    appendSignal({ root: file, entry: call({ session: 'a', at: 1 }) });
    expect(readFileSync(join(file, 'victim.txt'), 'utf8')).toBe('keep');
  });
});
