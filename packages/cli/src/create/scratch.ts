import { ProjectTmp } from '../hooks/project-tmp.ts';
import { mkdirSync, mkdtempSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProjectLayout } from '../common/index.ts';
import type { IPresetSpec } from './common/index.ts';
import { SubProcess } from './process.ts';

/** Removes `directory` when nothing is in it; one that holds anything stays. */
const removeIfEmpty = (opts: { directory: string }): void => {
  try {
    rmdirSync(opts.directory);
  } catch {
    // not empty, or not there
  }
};

export class PresetScratch {
  /**
   * An npm preset is read from node_modules, so it is installed into a scratch folder apart from the
   * project's own files, under `.agents/local/tmp/` (nothing goes outside the project): every refusal that depends on what the package says happens before anything is written.
   * One line says what is fetched; bun's own output would land between the questions, so it is kept
   * and shown only when the install fails.
   */
  static async installNpm(opts: { scratch: string; spec: IPresetSpec }): Promise<number> {
    writeFileSync(
      join(opts.scratch, 'package.json'),
      `${JSON.stringify({ name: 'vulcan-preset-scratch', private: true })}\n`,
    );

    const preset = `${opts.spec.packageName}@${opts.spec.range}`;

    process.stderr.write(`Fetching preset ${preset} ...\n`);

    return SubProcess.runBun({
      cwd: opts.scratch,
      args: ['add', preset],
      label: `bun add ${preset}`,
      quiet: true,
    });
  }

  /**
   * The scratch folder lives as long as the flow: the located preset's files are copied from it. It is
   * made under `<root>/.agents/local/tmp/`, and the folders made for it go with it when they are empty.
   */
  static async withScratch<TResult>(opts: {
    root: string;
    run: (scratch: string) => Promise<TResult>;
  }): Promise<TResult> {
    const local = join(opts.root, ProjectLayout.LOCAL_DIRECTORY);
    const parent = ProjectTmp.projectOf({ root: opts.root });

    mkdirSync(parent, { recursive: true });

    const scratch = mkdtempSync(join(parent, 'preset-'));

    try {
      const outcome = await opts.run(scratch);

      return outcome;
    } finally {
      rmSync(scratch, { recursive: true, force: true });
      removeIfEmpty({ directory: parent });
      removeIfEmpty({ directory: local });
      removeIfEmpty({ directory: join(opts.root, '.agents') });
    }
  }
}
