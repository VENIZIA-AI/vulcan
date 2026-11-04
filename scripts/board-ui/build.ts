import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const CLI = 'packages/cli';
const ENTRY = `${CLI}/src/board/ui/main.tsx`;
const SHELL = `${CLI}/src/board/ui/shell.html`;
const SCRIPT_MARKER = '<!--BOARD_SCRIPT-->';

/** Builds the board page from its TSX components into one static HTML file with the data marker left for `BoardPage.render`. */
export class BoardUiBuild {
  /** The component tree as one minified script. `entry` is relative to `root`; it defaults to the board's own. */
  static async bundle(opts: { root: string; entry?: string }): Promise<string> {
    const result = await Bun.build({
      entrypoints: [join(opts.root, opts.entry ?? ENTRY)],
      target: 'browser',
      format: 'iife',
      minify: true,
      define: { 'process.env.NODE_ENV': '"production"' },
      tsconfig: join(opts.root, CLI, 'tsconfig.json'),
      throw: false,
    });

    if (!result.success) {
      throw new Error(`the board UI did not build:\n${result.logs.map(String).join('\n')}`);
    }

    return result.outputs[0].text();
  }

  /**
   * A fingerprint of what the page is built from: every file of the components and the compiler settings. The shipped page
   * carries it, so a change to the source that was not followed by `make board-ui` is found on any Bun, even one whose
   * minifier writes the bundle differently.
   */
  static sourceHash(opts: { root: string }): string {
    const files = (folder: string): string[] =>
      readdirSync(join(opts.root, folder), { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? files(join(folder, entry.name)) : [join(folder, entry.name)],
      );
    const hash = createHash('sha256');

    for (const file of [...files(`${CLI}/src/board/ui`), `${CLI}/tsconfig.json`].sort()) {
      hash.update(`${file}\n${readFileSync(join(opts.root, file), 'utf8')}\n`);
    }

    return hash.digest('hex');
  }

  /** The page: the shell with the bundle inline. `</script` and `<!--` in the bundle are escaped so it cannot end its own tag. */
  static async build(opts: { root: string }): Promise<string> {
    const script = (await BoardUiBuild.bundle({ root: opts.root }))
      .replaceAll('</script', '<\\/script')
      .replaceAll('<!--', '<\\!--');

    return readFileSync(join(opts.root, SHELL), 'utf8').replace(
      SCRIPT_MARKER,
      () =>
        `<script>${script}</script>\n    <!-- built from ${BoardUiBuild.sourceHash({ root: opts.root })}; run make board-ui after a change to ${CLI}/src/board/ui -->`,
    );
  }
}

if (import.meta.main) {
  const root = join(import.meta.dir, '..', '..');
  const out = process.argv[2] ?? join(root, CLI, 'base/templates/board.html');
  const html = await BoardUiBuild.build({ root });

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  console.log(`${out}: ${Buffer.byteLength(html)} bytes`);
}
