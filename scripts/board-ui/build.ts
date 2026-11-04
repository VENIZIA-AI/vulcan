import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

  /** The page: the shell with the bundle inline. `</script` and `<!--` in the bundle are escaped so it cannot end its own tag. */
  static async build(opts: { root: string }): Promise<string> {
    const script = (await BoardUiBuild.bundle({ root: opts.root }))
      .replaceAll('</script', '<\\/script')
      .replaceAll('<!--', '<\\!--');

    return readFileSync(join(opts.root, SHELL), 'utf8').replace(
      SCRIPT_MARKER,
      () => `<script>${script}</script>`,
    );
  }
}

if (import.meta.main) {
  const root = join(import.meta.dir, '..', '..');
  const out = process.argv[2] ?? join(root, '.agents/local/reports/board-ui.html');
  const html = await BoardUiBuild.build({ root });

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  console.log(`${out}: ${Buffer.byteLength(html)} bytes`);
}
