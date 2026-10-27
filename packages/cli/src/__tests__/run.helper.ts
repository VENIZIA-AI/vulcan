import { join } from 'node:path';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';

const CLI = join(import.meta.dir, '..', 'cli.ts');

export interface ICliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export const runCli = (opts: {
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}): ICliResult => {
  const child = spawnSyncBounded({
    cmd: [process.execPath, CLI, ...opts.args],
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  return {
    code: child.exitCode ?? 1,
    stdout: child.stdout.toString(),
    stderr: child.stderr.toString(),
  };
};
