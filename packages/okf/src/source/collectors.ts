import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PATHS, REPO } from '../config.ts';
import type {
  BindingClass,
  ComponentEntry,
  HelperEntry,
  MakeTarget,
  SourceMapEntry,
} from './common/types.ts';
import { listDirs, packageDirs, sourceFiles } from './scanner.ts';

// --- shared heuristics ---
// One extraction per fact, used by BOTH the renderer and the coverage counter. BANA drifted
// here (coverage counted `extends BaseService`, the renderer matched `export class *Service`),
// so the two disagreed; keep every axis single-sourced from these functions.

export const exportedClasses = (opts: { dir: string; suffix: string }): string[] => {
  const { dir, suffix } = opts;

  const names = new Set<string>();
  const pattern = new RegExp(`export\\s+(?:abstract\\s+)?class\\s+(\\w+${suffix})\\b`, 'g');

  for (const file of sourceFiles({ dir })) {
    for (const match of readFileSync(file, 'utf8').matchAll(pattern)) {
      names.add(match[1]);
    }
  }

  return [...names].sort();
};

export const collectComponents = (): ComponentEntry[] => {
  return listDirs({ dir: PATHS.coreComponents }).map(dir => ({
    dir,
    classes: exportedClasses({ dir: join(PATHS.coreComponents, dir), suffix: 'Component' }),
  }));
};

export const collectHelperModules = (): HelperEntry[] => {
  return listDirs({ dir: PATHS.helpersModules }).map(module => ({
    module,
    classes: exportedClasses({ dir: join(PATHS.helpersModules, module), suffix: 'Helper' }),
  }));
};

export const collectHelperUtilities = (): string[] => {
  if (!existsSync(PATHS.helpersUtilities)) {
    return [];
  }

  return readdirSync(PATHS.helpersUtilities)
    .filter(name => name.endsWith('.utility.ts'))
    .map(name => name.replace(/\.utility\.ts$/, ''))
    .sort();
};

/** Const-classes of binding keys: `static readonly X = '...'` grouped by declaring class. */
export const collectBindingKeys = (): BindingClass[] => {
  if (!existsSync(PATHS.coreBindings)) {
    return [];
  }

  const src = readFileSync(PATHS.coreBindings, 'utf8');
  const out: BindingClass[] = [];

  for (const cls of src.matchAll(/export\s+class\s+(\w+)[^{]*\{([\s\S]*?)\n\}/g)) {
    // Line-anchored and single-line on purpose: `^\s*static` skips a `private static` member, and a
    // value class that cannot span lines stops a non-string member from swallowing the next constant.
    const keys = [
      ...cls[2].matchAll(/^\s*static\s+readonly\s+(\w+)\s*[:=][^'"`\n]*['"`]([^'"`\n]+)['"`]/gm),
    ].map(match => ({ key: match[1], value: match[2] }));

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
 */
export const collectMakefileTargets = (): MakeTarget[] => {
  if (!existsSync(PATHS.makefile)) {
    return [];
  }

  const db = Bun.spawnSync(['make', '--no-print-directory', '-pRrq', ':'], {
    cwd: REPO,
    stdout: 'pipe',
    stderr: 'pipe',
  }).stdout.toString();
  const lines = db.split('\n');

  const packagesLine = lines.find(line => line.startsWith('PACKAGES := ')) ?? '';
  const packages = packagesLine.slice('PACKAGES := '.length).split(' ').filter(Boolean);
  const pkgPattern = `(${[...packages, 'core'].join('|')})`;

  const help: { pattern: RegExp; description: string }[] = [];
  const helpFile = join(REPO, 'make/help.mk');
  const helpText = existsSync(helpFile) ? readFileSync(helpFile, 'utf8') : '';

  for (const row of helpText.matchAll(/HELP_ROW\) "((?:[^"\\]|\\.)+)" "((?:[^"\\]|\\.)*)"/g)) {
    const description = row[2].replace(/\\"/g, '"');

    for (const name of row[1].split(' / ')) {
      const bare = name.replace(/ ARGS=.*$/, '').trim();
      const escaped = bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('<pkg>', pkgPattern);

      help.push({ pattern: new RegExp(`^${escaped}$`), description });
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

    const description = help.find(entry => entry.pattern.test(match[1]))?.description ?? '';

    out.push({ name: match[1], deps: match[2].trim(), description });
  }

  return out.sort((a, b) => a.name.localeCompare(b.name));
};

export const collectSourceMap = (): SourceMapEntry[] => {
  const out: SourceMapEntry[] = [];

  for (const pkg of packageDirs()) {
    const src = join(PATHS.packages, pkg, 'src');

    if (!existsSync(src)) {
      continue;
    }

    const subsystems = listDirs({ dir: src })
      .filter(name => name !== '__tests__')
      .map(name => ({ name, files: sourceFiles({ dir: join(src, name) }).length }))
      .filter(entry => entry.files > 0)
      .sort((a, b) => b.files - a.files || a.name.localeCompare(b.name));

    out.push({
      pkg,
      total: sourceFiles({ dir: src }).filter(file => !file.includes('/__tests__/')).length,
      subsystems,
    });
  }

  return out;
};

/**
 * Bring prose lifted from outside the bundle in line with the repo docs style.
 *
 * package.json descriptions are npm-facing marketing copy: they carry em-dashes and spell the
 * brand "Ignis". The bundle is documentation, so it follows the docs rules (hyphen, always
 * "IGNIS") no matter where the text came from - and we do not rewrite package.json, which is
 * published to npm.
 */
export const sanitizeProse = (opts: { text: string }): string => {
  return opts.text
    .replace(/\s*[—–]\s*/g, ' - ')
    .replace(/\bIgnis\b/g, 'IGNIS')
    .replace(/\s+/g, ' ')
    .trim();
};

/** First sentence only - manifest descriptions run to paragraph length and would wreck the table. */
export const firstSentence = (opts: { text: string }): string => {
  const match = opts.text.match(/^(.*?[.!?])(\s|$)/);

  return (match ? match[1] : opts.text).trim();
};

export const collectPackageManifests = (): { dir: string; name: string; description: string }[] => {
  const out: { dir: string; name: string; description: string }[] = [];

  for (const dir of packageDirs()) {
    const manifest = join(PATHS.packages, dir, 'package.json');

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
      description: firstSentence({ text: sanitizeProse({ text: parsed.description ?? '' }) }),
    });
  }

  return out;
};
