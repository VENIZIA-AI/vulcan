import { afterAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { BoardCommand } from '../../board/command.ts';
import { BoardServe } from '../../board/common/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

interface IServeRun {
  stdout: string;
  stderr: string;
  targets: string[];
  code: number;
}

/** Runs `vulcan board serve --open` in-process with a stub for the program that opens the browser, and calls `during` while it serves. */
const serveWithOpener = async (opts: {
  during: (run: { targets: string[]; stdout: () => string }) => Promise<void>;
}): Promise<IServeRun> => {
  const cwd = createProject({
    files: { '.agents/vulcan.manifest.json': '{}', '.git/HEAD': 'ref: refs/heads/x\n' },
  });
  const targets: string[] = [];
  let stdout = '';
  let stderr = '';
  const writeOut = process.stdout.write.bind(process.stdout);
  const writeErr = process.stderr.write.bind(process.stderr);

  process.stdout.write = (chunk: string | Uint8Array): boolean => {
    stdout += String(chunk);

    return true;
  };
  process.stderr.write = (chunk: string | Uint8Array): boolean => {
    stderr += String(chunk);

    return true;
  };

  try {
    const done = BoardCommand.run({
      args: ['serve', '--open', '--port', '0', '--no-github', '--dir', join(cwd, 'events')],
      cwd,
      opener: ({ target }) => {
        targets.push(target);
      },
    });

    for (let waited = 0; targets.length === 0 && waited < 5000; waited += 20) {
      await Bun.sleep(20);
    }

    await opts.during({ targets, stdout: () => stdout });
    process.emit('SIGINT');

    const result = await done;
    return { stdout, stderr, targets, code: result };
  } finally {
    process.stdout.write = writeOut;
    process.stderr.write = writeErr;
  }
};

describe('vulcan board serve --open', () => {
  test('the opener gets an address with a one-time code and no token', async () => {
    let seen = '';
    const run = await serveWithOpener({
      during: async ({ stdout }) => {
        seen = stdout();
      },
    });
    const printed = new URL(seen.trim());
    const token = printed.searchParams.get(BoardServe.TOKEN_PARAM) ?? '';

    expect(run.code).toBe(0);
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(run.targets).toHaveLength(1);
    expect(run.targets[0]).toMatch(/^http:\/\/[^/]+\/open\/[0-9a-f]{32}$/);
    expect(run.targets[0]).not.toContain(token);
    expect(run.targets[0]).not.toContain(`${BoardServe.TOKEN_PARAM}=`);
    expect(new URL(run.targets[0]).host).toBe(printed.host);
  });

  test('the printed address still carries the token, and the code opens the board once', async () => {
    const statuses: number[] = [];
    let printed = '';
    let landed = 0;

    await serveWithOpener({
      during: async ({ targets, stdout }) => {
        printed = stdout().trim();

        const first = await fetch(targets[0], { redirect: 'manual' });
        const again = await fetch(targets[0], { redirect: 'manual' });
        const page = await fetch(new URL(first.headers.get('location') ?? '', targets[0]));

        statuses.push(first.status, again.status);
        landed = page.status;
      },
    });

    expect(new URL(printed).searchParams.get(BoardServe.TOKEN_PARAM)).toMatch(/^[0-9a-f]{32}$/);
    expect(statuses).toEqual([302, 403]);
    expect(landed).toBe(200);
  });

  test('the address in the note for a person who must open it by hand is the printed one, not the code', async () => {
    const run = await serveWithOpener({ during: async () => undefined });

    expect(run.stderr).toContain(`${BoardServe.TOKEN_PARAM}=`);
    expect(run.targets[0]).not.toContain(`${BoardServe.TOKEN_PARAM}=`);
  });
});
