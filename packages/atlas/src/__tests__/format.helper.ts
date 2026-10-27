import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';

/** The `[fmt]` section `vulcan init` writes to the project root. */
const BUNFIG =
  '[fmt]\nprintWidth = 100\nsingleQuote = true\narrowParens = "always"\nflavor = "oxfmt"\n';

/** Whether `bun fmt --check` accepts `text` as the file `file` of a project formatted by `init`'s `[fmt]`. */
export const isFormatted = (opts: {
  file: string;
  text: string;
}): { ok: boolean; output: string } => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-format-'));

  try {
    writeFileSync(join(root, 'bunfig.toml'), BUNFIG);
    writeFileSync(join(root, opts.file), opts.text);

    const result = spawnSyncBounded({
      cmd: [process.execPath, 'fmt', '--no-script', '--check', opts.file],
      cwd: root,
    });

    return { ok: result.exitCode === 0, output: `${result.stdout}${result.stderr}` };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};
