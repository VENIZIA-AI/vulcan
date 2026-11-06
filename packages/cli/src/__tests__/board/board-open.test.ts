import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BoardCommand } from '../../board/command.ts';
import { BoardServe } from '../../board/common/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

interface IServeRun {
  cwd: string;
  stdout: string;
  stderr: string;
  targets: string[];
  code: number;
}

/** Runs `vulcan board serve --open` in-process with a stub for the program that opens the browser, and calls `during` while it serves. */
const serveWithOpener = async (opts: {
  during: (run: { cwd: string; targets: string[]; stdout: () => string }) => Promise<void>;
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

    await opts.during({ cwd, targets, stdout: () => stdout });
    process.emit('SIGINT');

    const result = await done;

    return { cwd, stdout, stderr, targets, code: result };
  } finally {
    process.stdout.write = writeOut;
    process.stderr.write = writeErr;
  }
};

describe('vulcan board serve --open', () => {
  test('the opener gets a file only its owner can read, in the project tmp folder, with no token in it', async () => {
    let printed = '';
    let mode = 0;
    let exists = false;
    const run = await serveWithOpener({
      during: async ({ targets, stdout }) => {
        printed = stdout().trim();
        exists = existsSync(targets[0]);
        mode = statSync(targets[0]).mode & 0o777;
      },
    });
    const token = new URL(printed).searchParams.get(BoardServe.TOKEN_PARAM) ?? '';

    expect(run.code).toBe(0);
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(run.targets).toHaveLength(1);
    expect(run.targets[0].startsWith(join(run.cwd, '.agents/local/tmp'))).toBe(true);
    expect(run.targets[0]).toMatch(/board-open-[0-9a-f]{32}\.html$/);
    expect(run.targets[0]).not.toContain(token);
    expect(exists).toBe(true);
    expect(mode).toBe(0o600);
  });

  test('the file sends the browser to the printed address, which still carries the token', async () => {
    let printed = '';
    let body = '';

    await serveWithOpener({
      during: async ({ targets, stdout }) => {
        printed = stdout().trim();
        body = readFileSync(targets[0], 'utf8');
      },
    });

    expect(new URL(printed).searchParams.get(BoardServe.TOKEN_PARAM)).toMatch(/^[0-9a-f]{32}$/);
    expect(body).toContain(`<meta http-equiv="refresh" content="0;url=${printed}">`);
  });

  test('the file is gone once the board is reached, and the opener was never given the token address', async () => {
    let path = '';
    let status = 0;
    const run = await serveWithOpener({
      during: async ({ targets, stdout }) => {
        path = targets[0];
        const result = await fetch(stdout().trim());
        status = result.status;

        for (let waited = 0; existsSync(path) && waited < 3000; waited += 20) {
          await Bun.sleep(20);
        }
      },
    });
    const token = new URL(run.stdout.trim()).searchParams.get(BoardServe.TOKEN_PARAM) ?? '';

    expect(status).toBe(200);
    expect(existsSync(path)).toBe(false);
    expect(run.targets.join('\n')).not.toContain(token);
    expect(run.targets.join('\n')).not.toContain(`${BoardServe.TOKEN_PARAM}=`);
  });

  test('the file is gone when the server stops, even if the board was never reached', async () => {
    let path = '';

    await serveWithOpener({
      during: async ({ targets }) => {
        path = targets[0];
        expect(existsSync(path)).toBe(true);
      },
    });

    expect(existsSync(path)).toBe(false);
  });

  test('the note for a person who must open the board by hand is the printed address', async () => {
    const run = await serveWithOpener({ during: async () => undefined });

    expect(run.stderr).toContain(`${BoardServe.TOKEN_PARAM}=`);
  });
});
