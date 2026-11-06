import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { GitFiles } from '../common/git-files.ts';
import { LayoutFolder, LayoutKeys } from '../common/layout-folder.ts';
import type { ILayout } from '../common/layout-folder.ts';
import { TextValue } from '../common/text.ts';
import { WikiDefaults } from './constants.ts';

/**
 * Every source path the wiki and the knowledge bundle name must be tracked by git. Three kinds of
 * reference are read from each `.md` file: a `<repo>/blob/main/<path>` or `tree/main/<path>` GitHub link
 * (a link into another repository is never checked), a backticked path under a source root (checked
 * outside `skipProseUnder`, where a changelog may name history), and a knowledge concept's `resource:`
 * value (checked only under `.agents/knowledge`). `git ls-files` is the truth, not the disk: a
 * gitignored artifact is not on GitHub.
 */
const SOURCE_EXTENSIONS = ['ts', 'tsx', 'md', 'json', 'mjs', 'js', 'yaml', 'yml'];
const RESOURCE_LINE_PATTERN = /^resource:\s*(.+)$/;
const LINE_SUFFIX_PATTERN = /(:\d+|#L\d+)$/;

/**
 * The folders whose paths the check holds to git: where a project's source lives. With a `layout` they are the layout's
 * folders (backend, frontend, shared, other) and the folders every project has; without one, the list VULCAN's own
 * repository uses.
 */
export class SourceRoots {
  /** The folders every project has: its docs, its scripts and its agent files. */
  static readonly FIXED = ['docs/', 'scripts/', '.agents/'];
  /** What the check reads when the config has no layout. */
  static readonly DEFAULT = ['packages/', 'examples/', ...SourceRoots.FIXED];

  /** Each root ends with `/`. A layout folder the config would refuse is left out, and so is a repeat. */
  static of(opts: { layout?: ILayout }): string[] {
    const folders = LayoutKeys.ALL.flatMap((key) =>
      LayoutFolder.valid({ value: opts.layout?.[key] }),
    );

    if (folders.length === 0) {
      return SourceRoots.DEFAULT;
    }

    return [...new Set([...folders.map((folder) => `${folder}/`), ...SourceRoots.FIXED])];
  }

  /** A backticked path under a root. `{}` and `*` mark a template or a glob and `<>` a placeholder, never one real file. */
  static backtickPatternOf(opts: { roots: string[] }): RegExp {
    const roots = opts.roots.map((root) => TextValue.escapeLiteral({ text: root })).join('|');

    return new RegExp(
      `\`((?:${roots})[^\`{}*<>]+?\\.(?:${SOURCE_EXTENSIONS.join('|')})(?::\\d+|#L\\d+)?)\``,
      'g',
    );
  }
}

export interface IMissingSourceLink {
  file: string;
  line: number;
  path: string;
}

interface ITrackedPaths {
  files: Set<string>;
  directories: Set<string>;
}

const loadTracked = (opts: { root: string }): ITrackedPaths => {
  const tracked = GitFiles.tracked({ root: opts.root });

  if ('error' in tracked) {
    throw new Error(`git ls-files failed in ${opts.root}: ${tracked.error}`);
  }

  const files = new Set(tracked.files);
  const directories = new Set<string>();

  for (const file of files) {
    const segments = file.split('/');

    for (let depth = 1; depth < segments.length; depth += 1) {
      directories.add(segments.slice(0, depth).join('/'));
    }
  }

  return { files, directories };
};

const isUnder = (opts: { path: string; directory: string }): boolean =>
  opts.path === opts.directory || opts.path.startsWith(`${opts.directory}/`);

const walkMarkdown = (opts: { directory: string }): string[] => {
  if (!existsSync(opts.directory)) {
    return [];
  }

  return readdirSync(opts.directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(opts.directory, entry.name);

    if (entry.isDirectory()) {
      return walkMarkdown({ directory: full });
    }

    return entry.isFile() && entry.name.endsWith('.md') ? [full] : [];
  });
};

const extractPaths = (opts: {
  text: string;
  repo: string;
  skipProse: boolean;
  pattern: RegExp;
}): string[] => {
  const github = new RegExp(
    `${TextValue.escapeLiteral({ text: opts.repo })}/(?:blob|tree)/main/([^\\s)\\]"'\`<>]+)`,
    'g',
  );
  const found = [...opts.text.matchAll(github)].map((match) =>
    (match[1] ?? '').replace(LINE_SUFFIX_PATTERN, ''),
  );

  if (opts.skipProse) {
    return found;
  }

  const prose = [...opts.text.matchAll(opts.pattern)].map((match) =>
    (match[1] ?? '').replace(LINE_SUFFIX_PATTERN, ''),
  );

  return [...found, ...prose];
};

/** The `resource:` line of a concept's frontmatter, or none when it has no tracked prefix. */
const extractResource = (opts: {
  lines: string[];
  roots: string[];
}): { line: number; path: string } | undefined => {
  const { lines, roots } = opts;

  if (lines[0] !== '---') {
    return undefined;
  }

  const close = lines.indexOf('---', 1);

  if (close === -1) {
    return undefined;
  }

  for (let index = 1; index < close; index += 1) {
    const match = RESOURCE_LINE_PATTERN.exec(lines[index] ?? '');
    const value = match?.[1]
      ?.trim()
      .replace(/^["']|["']$/g, '')
      .replace(/\/+$/, '');

    if (value !== undefined && value !== '' && roots.some((root) => value.startsWith(root))) {
      return { line: index + 1, path: value };
    }
  }

  return undefined;
};

export class SourceLinkCheck {
  /**
   * Walks the `.md` files under `directories` (paths relative to `root`) and reports every source path
   * that git does not track. `skipFiles` are generated pages that are never held to the gate. `roots` are the
   * folders a path must start with to be checked (`SourceRoots.of`); the default list when left out.
   */
  static check(opts: {
    root: string;
    repo: string;
    directories: string[];
    skipProseUnder: string[];
    skipFiles: string[];
    roots?: string[];
  }): { checked: number; missing: IMissingSourceLink[] } {
    const { root, repo, skipFiles, skipProseUnder } = opts;
    const roots =
      opts.roots === undefined || opts.roots.length === 0 ? SourceRoots.DEFAULT : opts.roots;
    const pattern = SourceRoots.backtickPatternOf({ roots });
    const tracked = loadTracked({ root });
    const exists = (path: string): boolean =>
      tracked.files.has(path) || tracked.directories.has(path);
    const missing: IMissingSourceLink[] = [];
    let checked = 0;

    for (const directory of opts.directories) {
      for (const file of walkMarkdown({ directory: resolve(root, directory) })) {
        const path = relative(root, file);

        if (skipFiles.some((skip) => isUnder({ path, directory: skip }))) {
          continue;
        }

        const skipProse = skipProseUnder.some((skip) => isUnder({ path, directory: skip }));
        const lines = readFileSync(file, 'utf8').split('\n');
        const resource = isUnder({ path, directory: WikiDefaults.KNOWLEDGE_DIRECTORY })
          ? extractResource({ lines, roots })
          : undefined;

        if (resource !== undefined) {
          checked += 1;

          if (!exists(resource.path)) {
            missing.push({ file: path, line: resource.line, path: resource.path });
          }
        }

        for (const [index, text] of lines.entries()) {
          for (const found of extractPaths({ text, repo, skipProse, pattern })) {
            checked += 1;

            if (!exists(found)) {
              missing.push({ file: path, line: index + 1, path: found });
            }
          }
        }
      }
    }

    missing.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line);

    return { checked, missing };
  }
}
