import { readFileSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { ExitCodes } from '../common/index.ts';
import type { ICommandContext } from '../common/index.ts';
import { pageNameOf, renderSpecText, specSchemaText, writePage } from '../visualize/index.ts';

const SCHEMA_FLAG = '--schema';
const OUT_FLAG = '--out';

/**
 * `vulcan visualize <spec.json> [--out <name>]`: one small static HTML page from a JSON spec, written to
 * `.agents/local/prototypes/` (gitignored). `--schema` prints the spec's JSON Schema. The page needs no
 * network and nothing is published; the command says which of its own checks ran, and that the browser
 * check is the caller's.
 */
export const runVisualizeCommand = async (opts: ICommandContext): Promise<number> => {
  const outAt = opts.args.indexOf(OUT_FLAG);
  const out = outAt === -1 ? undefined : opts.args[outAt + 1];

  if (
    outAt !== -1 &&
    (out === undefined || out.startsWith('-') || opts.args.lastIndexOf(OUT_FLAG) !== outAt)
  ) {
    process.stderr.write(`vulcan visualize: ${OUT_FLAG} takes one page name\n`);

    return ExitCodes.FAILURE;
  }

  if (opts.args.includes(SCHEMA_FLAG)) {
    process.stdout.write(specSchemaText());

    return ExitCodes.OK;
  }

  const specArgument = opts.args.find(
    (arg, index) => !arg.startsWith('-') && (outAt === -1 || index !== outAt + 1),
  );

  if (specArgument === undefined) {
    process.stderr.write(
      'vulcan visualize: name the spec file - vulcan visualize <spec.json> [--out <name>], or --schema\n',
    );

    return ExitCodes.FAILURE;
  }

  const specFile = resolve(opts.cwd, specArgument);

  if (!statSync(specFile, { throwIfNoEntry: false })?.isFile()) {
    process.stderr.write(`vulcan visualize: ${specArgument} is not a file\n`);

    return ExitCodes.FAILURE;
  }

  const source = out ?? basename(specFile);
  const name = pageNameOf({ name: source });

  if (name === undefined) {
    process.stderr.write(
      `vulcan visualize: '${source}' does not give a page name (lowercase letters, digits and dashes) - use ${OUT_FLAG}\n`,
    );

    return ExitCodes.FAILURE;
  }

  let text: string;

  try {
    text = readFileSync(specFile, 'utf8');
  } catch (error) {
    process.stderr.write(
      `vulcan visualize: cannot read ${specArgument}: ${error instanceof Error ? error.message : String(error)}\n`,
    );

    return ExitCodes.FAILURE;
  }

  const rendered = renderSpecText({ text });

  if (!rendered.ok) {
    process.stderr.write(
      `vulcan visualize: the spec is not renderable, nothing was written:\n${rendered.problems.map((problem) => `  ${problem}`).join('\n')}\n`,
    );

    return ExitCodes.FAILURE;
  }

  const written = writePage({ root: opts.cwd, name, html: rendered.page.html });

  if (!written.ok) {
    process.stderr.write(`vulcan visualize: ${written.error}\n`);

    return ExitCodes.FAILURE;
  }

  process.stdout.write(`${written.path}\n`);

  for (const warning of rendered.page.warnings) {
    process.stderr.write(`warning: ${warning}\n`);
  }

  process.stderr.write(
    `vulcan visualize: wrote ${written.path} (${(rendered.page.bytes / 1024).toFixed(1)} KB)\nchecks that ran: ${rendered.page.checks.join('; ')}\nnot run here: a browser check at 390 and 1280 px - open the page and look, or say it was not browser-checked\n`,
  );

  return ExitCodes.OK;
};
