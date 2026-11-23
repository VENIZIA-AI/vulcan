import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BoardAutoStart } from '../../board/auto-start.ts';
import { VULCAN_CONFIG_SCHEMA } from '../../config/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const manifest = (opts: { autoStart?: boolean; log?: boolean }): string =>
  JSON.stringify({
    events: { log: opts.log ?? true },
    ...(opts.autoStart === undefined ? {} : { board: { serve: { autoStart: opts.autoStart } } }),
  });
// A stand-in for the project's own `vulcan`: it records its arguments and the folder it ran in, then exits.
const FAKE =
  "await Bun.write('started.txt', process.argv.slice(2).join(' ') + '|' + process.cwd());\n";
const project = (opts: { autoStart?: boolean; log?: boolean }): string =>
  createProject({
    files: {
      '.agents/vulcan.manifest.json': manifest(opts),
      'node_modules/.bin/vulcan': FAKE,
    },
  });
const waitFor = async (file: string): Promise<boolean> => {
  for (let at = 0; at < 100; at += 1) {
    if (existsSync(file)) {
      return true;
    }

    await Bun.sleep(50);
  }

  return false;
};
const listener = () => Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } });

describe('board.serve.autoStart in the config', () => {
  test('off by default, a boolean, and nothing else', () => {
    expect(VULCAN_CONFIG_SCHEMA.parse({}).board.serve).toEqual({ autoStart: false });
    expect(
      VULCAN_CONFIG_SCHEMA.parse({ board: { serve: { autoStart: true } } }).board.serve,
    ).toEqual({
      autoStart: true,
    });
    expect(VULCAN_CONFIG_SCHEMA.safeParse({ board: { serve: { autoStart: 'yes' } } }).success).toBe(
      false,
    );
    expect(VULCAN_CONFIG_SCHEMA.safeParse({ board: { serve: { port: 1 } } }).success).toBe(false);
  });
});

describe('the board started by a session', () => {
  test('it is on only with autoStart and the event log', () => {
    expect(BoardAutoStart.isOn({ root: project({ autoStart: true }) })).toBe(true);
    expect(BoardAutoStart.isOn({ root: project({}) })).toBe(false);
    expect(BoardAutoStart.isOn({ root: project({ autoStart: false }) })).toBe(false);
    expect(BoardAutoStart.isOn({ root: project({ autoStart: true, log: false }) })).toBe(false);
    expect(BoardAutoStart.isOn({ root: createProject({ files: {} }) })).toBe(false);
  });

  test('nothing listens: the project own vulcan starts detached, in the project, with its output in the log file', async () => {
    const root = project({ autoStart: true });
    const server = listener();
    const free = server.port;

    server.stop(true);

    const result = await BoardAutoStart.tick({ root, port: free });
    expect(result).toBe('started');
    const result2 = await waitFor(join(root, 'started.txt'));
    expect(result2).toBe(true);
    expect(readFileSync(join(root, 'started.txt'), 'utf8')).toBe(
      `board serve --port ${free}|${root}`,
    );
    expect(existsSync(join(root, '.agents/local/tmp/board-serve.log'))).toBe(true);
  });

  test('something already listens: nothing is started, twice never', async () => {
    const root = project({ autoStart: true });
    const server = listener();

    const result = await BoardAutoStart.tick({ root, port: server.port });
    expect(result).toBe('running');
    server.stop(true);
    await Bun.sleep(100);
    expect(existsSync(join(root, 'started.txt'))).toBe(false);
  });

  test('off: nothing is probed or started', async () => {
    const root = project({});

    const result = await BoardAutoStart.tick({ root, port: 1 });
    expect(result).toBe('off');
    expect(existsSync(join(root, '.agents/local/tmp'))).toBe(false);
  });
});
