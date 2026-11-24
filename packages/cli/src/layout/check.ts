import { Glob } from 'bun';
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LayoutFolder, LayoutKeys } from '../common/layout-folder.ts';
import { ProjectPackages } from '../config/packages.ts';
import type { TResolvedConfig } from '../config/schema.ts';
import type { TLayoutSettings } from '../config/sections/doctor/index.ts';
import { HookConstants } from '../hooks/common/index.ts';
import { GitQueries } from '../hooks/git-queries.ts';
import { LayoutConstants, LayoutRules } from './common/index.ts';
import type { ILayoutFinding, ILayoutFileText } from './common/index.ts';

const isWithin = (opts: { path: string; folder: string }): boolean =>
  opts.folder === '' || opts.path.startsWith(`${opts.folder}/`);

const parentOf = (opts: { path: string }): string => {
  const slash = opts.path.lastIndexOf('/');

  return slash === -1 ? '' : opts.path.slice(0, slash);
};

const nameOf = (opts: { path: string }): string => opts.path.slice(opts.path.lastIndexOf('/') + 1);

const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*|#!)/;

/** The comment lines a file opens with: where a tool says it wrote the file. */
const headerCommentOf = (opts: { head: string }): string => {
  const lines = opts.head.split('\n');
  const end = lines.findIndex((line) => !COMMENT_LINE.test(line));

  return lines.slice(0, end === -1 ? lines.length : end).join('\n');
};

/** The singular of a plural role word, or `undefined` when the word is not a plural. */
const singularOf = (opts: { word: string; allowed: Set<string> }): string | undefined => {
  const { word } = opts;

  if (opts.allowed.has(word)) {
    return undefined;
  }

  if (Object.hasOwn(LayoutConstants.IRREGULAR_PLURALS, word)) {
    return LayoutConstants.IRREGULAR_PLURALS[word];
  }

  if (!word.endsWith('s') || word.length < 3) {
    return undefined;
  }

  return word.endsWith('ies') ? `${word.slice(0, -3)}y` : word.slice(0, -1);
};

/** The layout check: plural role suffixes, folders that mix subfolders and loose files, long source files. */
export class LayoutCheck {
  /**
   * Every finding over the tracked `files` that sit under one of the `roots`, sorted by path then rule. `read` gives a
   * file's line count and its first lines, or `undefined` when it cannot be read (the file is skipped).
   */
  static check(opts: {
    files: string[];
    roots: string[];
    settings: TLayoutSettings;
    read: (opts: { file: string }) => ILayoutFileText | undefined;
  }): ILayoutFinding[] {
    const { settings } = opts;
    const allowed = new Set([...LayoutConstants.NOT_PLURAL, ...settings.pluralAllow]);
    const generated = settings.generated.map((pattern) => new Glob(pattern));
    const findings: ILayoutFinding[] = [];
    const folders = new Map<string, { subfolders: Set<string>; loose: string[] }>();
    const folderOf = (where: { folder: string }) => {
      const entry = folders.get(where.folder) ?? { subfolders: new Set<string>(), loose: [] };

      folders.set(where.folder, entry);

      return entry;
    };

    for (const file of opts.files) {
      const root = opts.roots.find((folder) => isWithin({ path: file, folder }));

      if (root === undefined) {
        continue;
      }

      let child = file;

      for (let folder = parentOf({ path: file }); ; folder = parentOf({ path: folder })) {
        if (child !== file) {
          folderOf({ folder }).subfolders.add(nameOf({ path: child }));
        }

        if (folder === root || !isWithin({ path: folder, folder: root })) {
          break;
        }

        child = folder;
      }

      const name = nameOf({ path: file });

      if (!LayoutConstants.SOURCE_FILE.test(name)) {
        continue;
      }

      if (!LayoutConstants.INDEX_FILES.includes(name)) {
        folderOf({ folder: parentOf({ path: file }) }).loose.push(name);
      }

      findings.push(...LayoutCheck.checkName({ file, name, allowed }));

      const text = opts.read({ file });

      if (
        text !== undefined &&
        text.lines > settings.maxLines &&
        !LayoutConstants.GENERATED_HEADER.test(headerCommentOf({ head: text.head })) &&
        !generated.some((glob) => glob.match(file))
      ) {
        findings.push({
          rule: LayoutRules.LONG_FILE,
          path: file,
          message: `${text.lines} lines, over doctor.layout.maxLines (${settings.maxLines}): split it by concern`,
        });
      }
    }

    for (const [folder, entry] of folders) {
      if (entry.subfolders.size >= settings.minSubfolders && entry.loose.length > 0) {
        findings.push({
          rule: LayoutRules.MIXED_FOLDER,
          path: folder,
          message: `${entry.subfolders.size} subfolders beside ${entry.loose.length} loose file(s) (${entry.loose.sort().join(', ')}): move the files into a subfolder; only index.ts or index.tsx stays beside subfolders`,
        });
      }
    }

    return findings.sort(
      (left, right) => left.path.localeCompare(right.path) || left.rule.localeCompare(right.rule),
    );
  }

  /** A `plural-suffix` finding for each plural role part of a name `<stem>.<role>[.<role>].<extension>`. */
  private static checkName(opts: {
    file: string;
    name: string;
    allowed: Set<string>;
  }): ILayoutFinding[] {
    const parts = opts.name.split('.');

    return parts.slice(1, -1).flatMap((word, index) => {
      const singular = singularOf({ word, allowed: opts.allowed });

      if (singular === undefined) {
        return [];
      }

      const renamed = parts.with(index + 1, singular).join('.');

      return [
        {
          rule: LayoutRules.PLURAL_SUFFIX,
          path: opts.file,
          message: `the role "${word}" is plural: name the file ${renamed}`,
        },
      ];
    });
  }

  /** The folders the check reads: each package path and each backend, frontend and shared layout folder; else every outermost `src` folder. */
  static roots(opts: { config: TResolvedConfig; files: string[] }): string[] {
    const declared = [
      ...ProjectPackages.resolve({ config: opts.config })
        .filter((entry) => !entry.retired)
        .map((entry) => entry.path),
      ...LayoutKeys.MANAGED.flatMap((key) =>
        LayoutFolder.valid({ value: opts.config.layout?.[key] }),
      ),
    ];

    if (declared.length > 0) {
      return [...new Set(declared)];
    }

    const found = new Set<string>();

    for (const file of opts.files) {
      const parts = file.split('/');
      const at = parts.indexOf(LayoutConstants.SOURCE_FOLDER);

      if (at !== -1 && at < parts.length - 1) {
        found.add(parts.slice(0, at + 1).join('/'));
      }
    }

    return [...found];
  }

  /** The files git tracks in `root`, read inert; `outside` when `root` is not in a git work tree, `error` when git does not list them. */
  static trackedFiles(opts: {
    root: string;
  }): { files: string[] } | { outside: true } | { error: string } {
    const inside = GitQueries.run({ args: ['rev-parse', '--is-inside-work-tree'], cwd: opts.root });

    if (inside !== 'true') {
      return { outside: true };
    }

    const listed = GitQueries.run({
      args: ['ls-files', '-z'],
      cwd: opts.root,
      maxBuffer: LayoutConstants.MAX_LISTING_BYTES,
      raw: true,
    });

    return listed === undefined
      ? {
          error: `git ls-files gave no listing in ${opts.root} (git failed, took over ${HookConstants.QUERY_TIMEOUT_MS / 1000} s, or listed over ${LayoutConstants.MAX_LISTING_BYTES / 1024 / 1024} MB)`,
        }
      : { files: listed.split('\0').filter((file) => file !== '') };
  }

  /** The line count and the first lines of a tracked regular file; `undefined` for a link, a folder or a missing file. */
  static readFile(opts: { root: string; file: string }): ILayoutFileText | undefined {
    const path = join(opts.root, opts.file);

    if (lstatSync(path, { throwIfNoEntry: false })?.isFile() !== true) {
      return undefined;
    }

    const lines = readFileSync(path, 'utf8').split('\n');

    if (lines[lines.length - 1] === '') {
      lines.pop();
    }

    return {
      lines: lines.length,
      head: lines.slice(0, LayoutConstants.HEADER_LINES).join('\n'),
    };
  }

  /** The findings of the project at `root`, or the reason the check cannot run. */
  static scan(opts: {
    root: string;
    config: TResolvedConfig;
  }): { findings: ILayoutFinding[] } | { outside: true } | { error: string } {
    const tracked = LayoutCheck.trackedFiles({ root: opts.root });

    if (!('files' in tracked)) {
      return tracked;
    }

    const { files } = tracked;

    return {
      findings: LayoutCheck.check({
        files,
        roots: LayoutCheck.roots({ config: opts.config, files }),
        settings: opts.config.doctor.layout,
        read: ({ file }) => LayoutCheck.readFile({ root: opts.root, file }),
      }),
    };
  }
}
