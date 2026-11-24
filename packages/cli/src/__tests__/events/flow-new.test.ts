import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EventLog } from '../../events/index.ts';
import { hermeticEnv } from '../hermetic.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const project = (): string =>
  createProject({
    files: {
      '.agents/local/vulcan.manifest.json': JSON.stringify({
        project: { key: 'ACME' },
        events: { log: true },
      }),
    },
  });
const cli = (opts: { root: string; args: string[] }) =>
  runCli({
    args: ['event', ...opts.args],
    cwd: opts.root,
    env: { ...hermeticEnv(), VULCAN_ACTOR: 'pnt-vulcan-1' },
  });
const linesOf = (root: string) => EventLog.read({ dir: join(root, '.agents/local/events') }).events;
const branch = (opts: { root: string; name: string }): void => {
  mkdirSync(join(opts.root, '.git'), { recursive: true });
  writeFileSync(join(opts.root, '.git/HEAD'), `ref: refs/heads/${opts.name}\n`);
};

describe('a flow line with no --flow is always a new flow', () => {
  const open = (root: string): string =>
    cli({
      root,
      args: [
        'add',
        '--kind',
        'flow',
        '--title',
        'First flow',
        '--why',
        'the reason',
        '--step',
        'one',
        '--step-done',
        'two',
      ],
    }).stdout.trim();

  test('on a branch named after an open flow it makes a new flow and leaves the open one as it was', () => {
    const root = project();
    const first = open(root);

    branch({ root, name: `feature/${first}-first` });

    const second = cli({
      root,
      args: ['add', '--kind', 'flow', '--title', 'Second flow', '--step', 'a'],
    }).stdout.trim();

    expect(first).toBe('VULZ-ACME-1');
    expect(second).toBe('VULZ-ACME-2');

    const flows = linesOf(root).filter((line) => line.kind === 'flow');

    expect(flows.map((line) => [line.flowId, line.summary])).toEqual([
      [first, 'First flow'],
      [second, 'Second flow'],
    ]);
    expect(flows[0]?.steps).toEqual([
      { text: 'one', done: false },
      { text: 'two', done: true },
    ]);
  });

  test('on a branch named after a flow that is over it is a new flow too', () => {
    const root = project();
    const first = open(root);

    cli({ root, args: ['add', '--kind', 'deploy', '--flow', first, '--summary', 'live'] });
    branch({ root, name: `feature/${first}-first` });
    expect(cli({ root, args: ['add', '--kind', 'flow', '--title', 'Next'] }).stdout.trim()).toBe(
      'VULZ-ACME-2',
    );
  });

  test('an explicit --flow still updates that flow, and the other lines still follow the branch', () => {
    const root = project();
    const first = open(root);

    branch({ root, name: `feature/${first}-first` });
    cli({
      root,
      args: [
        'add',
        '--kind',
        'flow',
        '--flow',
        first,
        '--title',
        'First flow, renamed',
        '--step-done',
        'one',
      ],
    });
    cli({ root, args: ['add', '--kind', 'commit', '--summary', 'a commit'] });

    const lines = linesOf(root);

    expect(lines.filter((line) => line.kind === 'flow').map((line) => line.summary)).toEqual([
      'First flow',
      'First flow, renamed',
    ]);
    expect(lines.find((line) => line.kind === 'commit')?.flowId).toBe(first);
  });

  test('the step command still names the flow of the branch', () => {
    const root = project();
    const first = open(root);

    branch({ root, name: `feature/${first}-first` });
    expect(cli({ root, args: ['step', '--done', 'one'] }).code).toBe(0);
    expect(linesOf(root).at(-1)?.steps?.[0]).toEqual({ text: 'one', done: true });
  });
});
