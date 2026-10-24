import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { readOkfProject } from '../project/index.ts';
import type { BindingClass, MakeTarget, SourceMapEntry } from './common/types.ts';
import { listDirs, listPackages, sourceFiles } from './scanner.ts';

/** A path under the project root. */
const projectPath = (opts: { path: string }): string => join(readOkfProject().root, opts.path);

/** Const-classes of binding keys in one file: `static readonly X = '...'` grouped by declaring class. */
export const collectBindingKeys = (opts: { file: string }): BindingClass[] => {
  if (!existsSync(opts.file)) {
    return [];
  }

  const src = readFileSync(opts.file, 'utf8');
  const out: BindingClass[] = [];

  for (const cls of src.matchAll(/export\s+class\s+(\w+)[^{]*\{([\s\S]*?)\n\}/g)) {
    // Line-anchored and single-line on purpose: `^\s*static` skips a `private static` member, and a
    // value class that cannot span lines stops a non-string member from swallowing the next constant.
    const keys = [
      ...cls[2].matchAll(/^\s*static\s+readonly\s+(\w+)\s*[:=][^'"`\n]*['"`]([^'"`\n]+)['"`]/gm),
    ].map((match) => ({ key: match[1], value: match[2] }));

    if (keys.length) {
      out.push({ name: cls[1], keys });
    }
  }

  return out.sort((a, b) => a.name.localeCompare(b.name));
};

/**
 * Every root make target, read from make's own database (`make -pRrq`), so the targets generated
 * from `PACKAGES` are listed too. The description comes from the target's `make help` row
 * (make/help.mk): an exact name, a name in an `a / b` row, or a `<pkg>` row matching one package.
 * Without one, from a `target: ## description` line in any makefile make read - how a shipped module
 * such as vulcan.mk describes its targets.
 */
export const collectMakefileTargets = (): MakeTarget[] => {
  if (!existsSync(projectPath({ path: 'Makefile' }))) {
    return [];
  }

  let made: ReturnType<typeof Bun.spawnSync>;

  try {
    made = Bun.spawnSync(['make', '--no-print-directory', '-pRrq', ':'], {
      cwd: readOkfProject().root,
      env: { ...process.env },
      stdout: 'pipe',
      stderr: 'pipe',
    });
  } catch (error) {
    throw new Error(
      `okf: make is not on PATH - the Makefile targets page needs it (${error instanceof Error ? error.message : String(error)})`,
      { cause: error },
    );
  }

  // Asking for the target `:` prints the database and always ends in "No rule to make target ':'";
  // any other `***` error (warnings are not errors) is make failing to read the Makefile, and a page written from what it printed
  // before failing would be truncated.
  const reason = (made.stderr ?? '')
    .toString()
    .split('\n')
    .find((line) => line.includes('*** ') && !line.includes("No rule to make target ':'"));

  if (reason !== undefined) {
    throw new Error(`okf: make failed: ${reason}`);
  }

  const db = (made.stdout ?? '').toString();
  const lines = db.split('\n');

  const packagesLine = lines.find((line) => line.startsWith('PACKAGES := ')) ?? '';
  const packages = packagesLine.slice('PACKAGES := '.length).split(' ').filter(Boolean);
  const pkgPattern = `(${[...packages, 'core'].join('|')})`;

  const help: { pattern: RegExp; description: string }[] = [];
  const helpFile = projectPath({ path: 'make/help.mk' });
  const helpText = existsSync(helpFile) ? readFileSync(helpFile, 'utf8') : '';

  for (const row of helpText.matchAll(/HELP_ROW\) "((?:[^"\\]|\\.)+)" "((?:[^"\\]|\\.)*)"/g)) {
    const description = row[2].replace(/\\"/g, '"');

    for (const name of row[1].split(' / ')) {
      const bare = name.replace(/ ARGS=.*$/, '').trim();
      const escaped = bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('<pkg>', pkgPattern);

      help.push({ pattern: new RegExp(`^${escaped}$`), description });
    }
  }

  const commented = new Map<string, string>();
  const makefiles = (lines.find((line) => line.startsWith('MAKEFILE_LIST := ')) ?? '')
    .slice('MAKEFILE_LIST := '.length)
    .split(' ')
    .filter(Boolean);

  for (const makefile of makefiles) {
    // make lists an include by the path it was given: relative to the root, or absolute.
    const file = isAbsolute(makefile) ? makefile : projectPath({ path: makefile });
    const makefileText = existsSync(file) ? readFileSync(file, 'utf8') : '';

    // A `;` starts an inline recipe: a `##` after it is the recipe's, never the description.
    for (const row of makefileText.matchAll(/^([a-z][\w-]*):[^#=;\n]*##\s*(.+)$/gm)) {
      commented.set(row[1], row[2].trim());
    }
  }

  const out: MakeTarget[] = [];

  for (let index = 0; index < lines.length; index++) {
    if (lines[index] === '# Not a target:') {
      index++;
      continue;
    }

    const match = lines[index].match(/^([a-z][\w-]*):(?![:=])\s*(.*)$/);

    if (!match) {
      continue;
    }

    const description =
      help.find((entry) => entry.pattern.test(match[1]))?.description ??
      commented.get(match[1]) ??
      '';

    out.push({ name: match[1], deps: match[2].trim(), description });
  }

  return out.sort((a, b) => a.name.localeCompare(b.name));
};

export const collectSourceMap = (): SourceMapEntry[] => {
  const out: SourceMapEntry[] = [];

  for (const { dir: pkg, path } of listPackages()) {
    const src = join(path, 'src');

    if (!existsSync(src)) {
      continue;
    }

    const subsystems = listDirs({ dir: src })
      .filter((name) => name !== '__tests__')
      .map((name) => ({ name, files: sourceFiles({ dir: join(src, name) }).length }))
      .filter((entry) => entry.files > 0)
      .sort((a, b) => b.files - a.files || a.name.localeCompare(b.name));

    out.push({
      pkg,
      // Relative to src/: a project that itself sits under a __tests__ directory still counts its files.
      total: sourceFiles({ dir: src }).filter(
        (file) => !`/${relative(src, file)}`.includes('/__tests__/'),
      ).length,
      subsystems,
    });
  }

  return out;
};

/**
 * The spelling an all-caps brand forbids: its title case (`ACME` forbids `Acme`). A brand that is
 * not all caps forbids nothing. One rule, read by the prose cleanup and the docs style check.
 */
export const brandSpelling = (opts: { brand: string }): RegExp | undefined => {
  if (!/^[A-Z]{2,}$/.test(opts.brand)) {
    return undefined;
  }

  const titled = opts.brand[0] + opts.brand.slice(1).toLowerCase();

  return new RegExp(`\\b${titled}\\b`, 'g');
};

/**
 * Bring prose lifted from outside the bundle in line with the repo docs style.
 *
 * package.json descriptions are npm-facing marketing copy: they carry em-dashes and may spell an
 * all-caps brand in title case ("Acme"). The bundle is documentation, so it follows the docs rules
 * (hyphen, the brand as written) no matter where the text came from - and we do not rewrite
 * package.json, which is published to npm.
 */
export const sanitizeProse = (opts: { text: string; brand: string }): string => {
  const brandRule = brandSpelling({ brand: opts.brand });
  const dashed = opts.text.replace(/\s*[—–]\s*/g, ' - ');

  return (brandRule ? dashed.replace(brandRule, opts.brand) : dashed).replace(/\s+/g, ' ').trim();
};

/** First sentence only - manifest descriptions run to paragraph length and would wreck the table. */
export const firstSentence = (opts: { text: string }): string => {
  const match = opts.text.match(/^(.*?[.!?])(\s|$)/);

  return (match ? match[1] : opts.text).trim();
};

export const collectPackageManifests = (): { dir: string; name: string; description: string }[] => {
  const out: { dir: string; name: string; description: string }[] = [];

  for (const { dir, path } of listPackages()) {
    const manifest = join(path, 'package.json');

    if (!existsSync(manifest)) {
      continue;
    }

    const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as {
      name?: string;
      description?: string;
    };

    // Deliberately no `version` - it churns the bundle on every release.
    out.push({
      dir,
      name: parsed.name ?? dir,
      description: firstSentence({
        text: sanitizeProse({ text: parsed.description ?? '', brand: readOkfProject().viz.brand }),
      }),
    });
  }

  return out;
};
