import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IPresetSpec } from './common/index.ts';
import { runBun } from './process.ts';

/**
 * An npm preset is read from node_modules, so it is installed into a scratch folder outside the
 * project: every refusal that depends on what the package says happens before anything is written.
 */
export const installNpmPreset = async (opts: {
  scratch: string;
  spec: IPresetSpec;
}): Promise<number> => {
  writeFileSync(
    join(opts.scratch, 'package.json'),
    `${JSON.stringify({ name: 'vulcan-preset-scratch', private: true })}\n`,
  );

  return runBun({
    cwd: opts.scratch,
    args: ['add', `${opts.spec.packageName}@${opts.spec.range}`],
    label: `bun add ${opts.spec.packageName}@${opts.spec.range}`,
  });
};

/** The scratch folder lives as long as the flow: the located preset's files are copied from it. */
export const withScratch = async <TResult>(opts: {
  run: (scratch: string) => Promise<TResult>;
}): Promise<TResult> => {
  const scratch = mkdtempSync(join(tmpdir(), 'vulcan-preset-'));

  try {
    return await opts.run(scratch);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};
