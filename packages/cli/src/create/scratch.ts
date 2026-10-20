import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IPresetSpec } from './common/index.ts';
import { runBun } from './process.ts';

/**
 * An npm preset is read from node_modules, so it is installed into a scratch folder outside the
 * project: every refusal that depends on what the package says happens before anything is written.
 * One line says what is fetched; bun's own output would land between the questions, so it is kept
 * and shown only when the install fails.
 */
export const installNpmPreset = async (opts: {
  scratch: string;
  spec: IPresetSpec;
}): Promise<number> => {
  writeFileSync(
    join(opts.scratch, 'package.json'),
    `${JSON.stringify({ name: 'vulcan-preset-scratch', private: true })}\n`,
  );

  const preset = `${opts.spec.packageName}@${opts.spec.range}`;

  process.stderr.write(`Fetching preset ${preset} ...\n`);

  return runBun({
    cwd: opts.scratch,
    args: ['add', preset],
    label: `bun add ${preset}`,
    quiet: true,
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
