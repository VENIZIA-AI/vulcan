import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BoardCommand } from '../../board/command.ts';
import { BoardGithub } from '../../board/github.ts';
import { EventFlow, EventLog, EventRetention, FlowId } from '../../events/index.ts';
import { hermeticEnv } from '../hermetic.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const BASE = Date.parse('2026-11-01T09:00:00Z');
const line = (id: string, order = 0) =>
  `${JSON.stringify(EventLog.build({ kind: 'commit', summary: 'seed', actor: 'a', source: 'cli', flowId: id, now: BASE + order * 1000 }))}\n`;

const project = (opts: { key?: string; seeds?: string[]; branch?: string } = {}): string =>
  createProject({
    files: {
      '.agents/vulcan.manifest.json': JSON.stringify(
        opts.key === undefined ? {} : { project: { key: opts.key } },
      ),
      ...(opts.seeds === undefined
        ? {}
        : {
            '.agents/local/events/2026-11-01.jsonl': opts.seeds
              .map((id, order) => line(id, order))
              .join(''),
          }),
      ...(opts.branch === undefined ? {} : { '.git/HEAD': `ref: refs/heads/${opts.branch}\n` }),
    },
  });
const events = (root: string) => join(root, '.agents/local/events');
const cli = (opts: { root: string; args: string[] }) =>
  runCli({
    args: ['event', ...opts.args],
    cwd: opts.root,
    env: { ...hermeticEnv(), VULCAN_ACTOR: 'pnt-vulcan-1' },
  });
const flowIds = (root: string): string[] =>
  EventLog.read({ dir: events(root) }).events.flatMap((event) =>
    event.kind === 'flow' && event.flowId !== undefined ? [event.flowId] : [],
  );

describe('a flow made by the command', () => {
  test('a flow line with no id makes the next one for the key, and prints it', () => {
    const root = project({ key: 'ACME' });
    const first = cli({ root, args: ['add', '--kind', 'flow', '--title', 'Sign in'] });
    const second = cli({ root, args: ['add', '--kind', 'flow', '--title', 'Pay'] });

    expect(first.code, first.stderr).toBe(0);
    expect(first.stdout.trim()).toBe('VULZ-ACME-1');
    expect(second.stdout.trim()).toBe('VULZ-ACME-2');
    expect(flowIds(root)).toEqual(['VULZ-ACME-1', 'VULZ-ACME-2']);
  });

  test('without a project key the command refuses and says what to set; nothing is written', () => {
    const root = project();
    const result = cli({ root, args: ['add', '--kind', 'flow', '--title', 'Sign in'] });

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('project.key');
    expect(existsSync(events(root))).toBe(false);
  });

  test('the number goes above every older F-n of the log, and a flow line on the branch of a flow updates it', () => {
    const root = project({ key: 'ACME', seeds: ['F-9', 'F-12'], branch: 'feature/F-12-x' });
    const update = cli({ root, args: ['add', '--kind', 'flow', '--title', 'Renamed'] });
    const off = project({ key: 'ACME', seeds: ['F-9', 'F-12'] });
    const made = cli({ root: off, args: ['add', '--kind', 'flow', '--title', 'New'] });

    expect(update.code, update.stderr).toBe(0);
    expect(flowIds(root)).toEqual(['F-12']);
    expect(made.stdout.trim()).toBe('VULZ-ACME-13');
  });
});

describe('--flow must name a flow that exists', () => {
  test('an id the log does not have is refused, with the recent flows listed, and nothing is written', () => {
    const root = project({ key: 'ACME', seeds: ['VULZ-ACME-1', 'VULZ-ACME-2'] });
    const result = cli({
      root,
      args: ['add', '--kind', 'commit', '--summary', 'x', '--flow', 'VULZ-ACME-99'],
    });

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('no flow VULZ-ACME-99');
    expect(result.stderr).toContain('VULZ-ACME-2, VULZ-ACME-1');
    expect(EventLog.read({ dir: events(root) }).events).toHaveLength(2);
  });

  test('a log with no flow says so, and an id of a wrong shape is refused as before', () => {
    const root = project({ key: 'ACME' });
    const none = cli({
      root,
      args: ['add', '--kind', 'commit', '--summary', 'x', '--flow', 'VULZ-ACME-1'],
    });
    const shape = cli({
      root,
      args: ['add', '--kind', 'commit', '--summary', 'x', '--flow', 'acme-1'],
    });

    expect(none.stderr).toContain('no flow yet');
    expect(shape.code).toBe(2);
    expect(shape.stderr).toContain('must look like');
  });

  test('an older F-n of the log is the same flow as VULZ-<key>-n, whichever is written', () => {
    const root = project({ key: 'ACME', seeds: ['F-7'] });
    const asNew = cli({
      root,
      args: ['add', '--kind', 'commit', '--summary', 'x', '--flow', 'VULZ-ACME-7'],
    });
    const asOld = cli({
      root,
      args: ['add', '--kind', 'commit', '--summary', 'x', '--flow', 'F-7'],
    });

    expect(asNew.code, asNew.stderr).toBe(0);
    expect(asOld.code, asOld.stderr).toBe(0);
  });

  test('a flow named only by the branch is taken as it is, as the hooks take it', () => {
    const root = project({ key: 'ACME', branch: 'feature/VULZ-ACME-5-x' });
    const result = cli({ root, args: ['add', '--kind', 'commit', '--summary', 'x'] });

    expect(result.code, result.stderr).toBe(0);
    expect(EventLog.read({ dir: events(root) }).events[0].flowId).toBe('VULZ-ACME-5');
  });
});

describe('a number is claimed, never given twice', () => {
  const nextIn = (dir: string, count: number): Promise<string[]> => {
    const script = `import { FlowId } from '${join(import.meta.dir, '..', '..', 'events', 'flow-id.ts')}'; console.log(FlowId.next({ dir: ${JSON.stringify(dir)}, key: 'ACME' }));`;

    return Promise.all(
      Array.from({ length: count }, () =>
        Bun.spawn(['bun', '-e', script], { stdout: 'pipe', stderr: 'pipe' }),
      ).map((proc) => new Response(proc.stdout).text()),
    ).then((printed) => printed.map((text) => text.trim()));
  };

  test('a number is claimed by a file, and the next search starts above every claim, also when the log has none', () => {
    const dir = join(createProject({ files: {} }), 'events');

    expect(FlowId.next({ dir, key: 'ACME' })).toBe('VULZ-ACME-1');
    expect(FlowId.next({ dir, key: 'ACME' })).toBe('VULZ-ACME-2');
    expect(readdirSync(join(dir, '.flow-ids')).sort()).toEqual(['ACME-1', 'ACME-2']);
    expect(EventLog.read({ dir }).events).toEqual([]);
    expect(FlowId.next({ dir, key: 'ACME' })).toBe('VULZ-ACME-3');
  });

  test('a key counts on its own; the log counts for it, and an older F-n for every key', () => {
    const dir = join(createProject({ files: {} }), 'events');

    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '2026-11-01.jsonl'), line('VULZ-ACME-6') + line('F-9'));

    expect(FlowId.next({ dir, key: 'ACME' })).toBe('VULZ-ACME-10');
    expect(FlowId.next({ dir, key: 'OTHER' })).toBe('VULZ-OTHER-10');
  });

  test('a claim someone just made is stepped over, not shared: the search goes on to a free number', () => {
    const dir = join(createProject({ files: {} }), 'events');

    mkdirSync(join(dir, '.flow-ids'), { recursive: true });
    writeFileSync(join(dir, '.flow-ids', 'ACME-1'), '');
    writeFileSync(join(dir, '.flow-ids', 'ACME-2'), '');
    writeFileSync(join(dir, '.flow-ids', 'ACME-x'), '');
    writeFileSync(join(dir, '.flow-ids', 'OTHER-40'), '');

    expect(FlowId.next({ dir, key: 'ACME' })).toBe('VULZ-ACME-3');
  });

  test('twelve processes, fifteen rounds, with a claim that was made a moment before: every id is different', async () => {
    const root = createProject({ files: {} });

    for (let round = 0; round < 15; round++) {
      const dir = join(root, `events-${round}`);

      mkdirSync(join(dir, '.flow-ids'), { recursive: true });
      writeFileSync(join(dir, '.flow-ids', 'ACME-1'), '');

      const ids = await nextIn(dir, 12);

      expect(new Set(ids).size, `round ${round}: ${ids.join(' ')}`).toBe(12);
      expect(ids.every((id) => /^VULZ-ACME-\d+$/.test(id))).toBe(true);
      expect(Math.min(...ids.map((id) => FlowId.numberOf({ id })))).toBeGreaterThan(1);
    }
  });
});

describe('where an id is read from', () => {
  test('a message, a branch and a pull request name a flow in the new form and in the older one', () => {
    expect(EventFlow.fromText({ text: 'Flow: VULZ-ACME-15\nthe rest' })).toBe('VULZ-ACME-15');
    expect(EventFlow.fromText({ text: 'Flow: F-15' })).toBe('F-15');
    expect(EventFlow.fromBranchName({ branch: 'feature/VULZ-ACME-15-sign-in' })).toBe(
      'VULZ-ACME-15',
    );
    expect(EventFlow.fromBranchName({ branch: 'VULZ-AB1-2' })).toBe('VULZ-AB1-2');
    expect(EventFlow.fromBranchName({ branch: 'feature/F-12-x' })).toBe('F-12');
    expect(EventFlow.fromBranchName({ branch: 'feature/VULZ-acme-15-x' })).toBeUndefined();
    expect(EventFlow.fromBranchName({ branch: 'feature/NOVULZ-ACME-15-x' })).toBeUndefined();
    expect(BoardGithub.flowOf({ body: 'Flow: VULZ-ACME-3', branch: 'main' })).toBe('VULZ-ACME-3');
    expect(BoardGithub.flowOf({ body: '', branch: 'fix/VULZ-ACME-4-x' })).toBe('VULZ-ACME-4');
  });

  test('FlowId.canon shows an older id in the new form when the project has a key, and never changes a new one', () => {
    expect(FlowId.canon({ id: 'F-12', key: 'ACME' })).toBe('VULZ-ACME-12');
    expect(FlowId.canon({ id: 'F-12' })).toBe('F-12');
    expect(FlowId.canon({ id: 'VULZ-ACME-12', key: 'ACME' })).toBe('VULZ-ACME-12');
    expect(FlowId.canon({ id: 'Unsorted', key: 'ACME' })).toBe('Unsorted');
  });
});

describe('the board shows an older id in the new form', () => {
  const flowsOf = (opts: { key?: string }): string[] => {
    const root = project({ key: opts.key, seeds: ['F-12', 'VULZ-ACME-12', 'F-3'] });
    const data = BoardCommand.collect({
      root,
      dir: events(root),
      since: 0,
      args: { repos: [], noGithub: true },
    });

    return data.flows.map((flow) => flow.id).sort();
  };

  test('with a key, F-12 and VULZ-ACME-12 are one flow, and the log is not rewritten', () => {
    expect(flowsOf({ key: 'ACME' })).toEqual(['VULZ-ACME-12', 'VULZ-ACME-3']);

    const root = project({ key: 'ACME', seeds: ['F-12'] });

    expect(EventLog.read({ dir: events(root) }).events[0].flowId).toBe('F-12');
  });

  test('without a key the ids stay as they are', () => {
    expect(flowsOf({})).toEqual(['F-12', 'F-3', 'VULZ-ACME-12']);
  });
});

describe('the claims are not part of the log', () => {
  test('the retention never plans the claims: only the day files go', () => {
    const dir = join(createProject({ files: {} }), 'events');

    FlowId.next({ dir, key: 'ACME' });
    writeFileSync(join(dir, '2020-01-01.jsonl'), line('F-1'));

    const plan = EventRetention.plan({
      dir,
      limits: { maxBytes: 1, maxFiles: 1, maxAgeDays: 1 },
      now: Date.now(),
    });
    const removed = JSON.stringify(plan);

    expect(removed).toContain('2020-01-01.jsonl');
    expect(removed).not.toContain('.flow-ids');
  });
});

describe('a flow line on the branch of a flow that is over makes a new flow', () => {
  const log = (
    lines: {
      kind: 'commit' | 'pr' | 'decision';
      ref?: string;
      status?: 'approve' | 'park' | 'reject';
    }[],
  ): string =>
    lines
      .map((one, order) =>
        JSON.stringify(
          EventLog.build({
            kind: one.kind,
            summary: 'x',
            actor: 'a',
            source: 'cli',
            flowId: 'VULZ-ACME-4',
            now: Date.parse('2026-11-01T09:00:00Z') + order * 1000,
            ...(one.ref === undefined ? {} : { ref: one.ref }),
            ...(one.status === undefined ? {} : { status: one.status }),
          }),
        ),
      )
      .join('\n');
  const made = (lines: Parameters<typeof log>[0]): string => {
    const root = createProject({
      files: {
        '.agents/vulcan.manifest.json': JSON.stringify({ project: { key: 'ACME' } }),
        '.agents/local/events/2026-11-01.jsonl': `${log(lines)}\n`,
        '.git/HEAD': 'ref: refs/heads/feature/VULZ-ACME-4-x\n',
      },
    });

    return cli({ root, args: ['add', '--kind', 'flow', '--title', 'T'] }).stdout.trim();
  };

  test('open: the flow is updated; merged, parked or rejected: a new flow with the next number', () => {
    expect(made([{ kind: 'commit' }])).toBe('VULZ-ACME-4');
    expect(made([{ kind: 'pr', ref: 'merged:9' }])).toBe('VULZ-ACME-5');
    expect(made([{ kind: 'decision', status: 'park' }])).toBe('VULZ-ACME-5');
    expect(made([{ kind: 'decision', status: 'reject' }])).toBe('VULZ-ACME-5');
    expect(made([{ kind: 'decision', status: 'approve' }])).toBe('VULZ-ACME-4');
  });

  test('work after the merge reopens it, so the flow is updated again', () => {
    expect(made([{ kind: 'pr', ref: 'merged:9' }, { kind: 'commit' }])).toBe('VULZ-ACME-4');
  });

  test('--flow names a flow that is over on purpose, and is taken', () => {
    const root = createProject({
      files: {
        '.agents/vulcan.manifest.json': JSON.stringify({ project: { key: 'ACME' } }),
        '.agents/local/events/2026-11-01.jsonl': `${log([{ kind: 'pr', ref: 'merged:9' }])}\n`,
      },
    });
    const result = cli({
      root,
      args: ['add', '--kind', 'flow', '--flow', 'VULZ-ACME-4', '--title', 'T'],
    });

    expect(result.code, result.stderr).toBe(0);
  });
});
