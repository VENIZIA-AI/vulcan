import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { WikiDefaults } from './constants.ts';

/**
 * Every source path the wiki and the knowledge bundle name must be tracked by git. Three kinds of
 * reference are read from each `.md` file: a `<repo>/blob/main/<path>` or `tree/main/<path>` GitHub link
 * (a link into another repository is never checked), a backticked path under a source root (checked
 * outside `skipProseUnder`, where a changelog may name history), and a knowledge concept's `resource:`
 * value (checked only under `.agents/knowledge`). `git ls-files` is the truth, not the disk: a
 * gitignored artifact is not on GitHub.
 */
const SOURCE_ROOTS = ['packages/', 'examples/', 'scripts/', 'docs/', '.agents/'];
const SOURCE_EXTENSIONS = ['ts', 'tsx', 'md', 'json', 'mjs', 'js', 'yaml', 'yml'];
const RESOURCE_LINE_PATTERN = /^resource:\s*(.+)$/;
const LINE_SUFFIX_PATTERN = /(:\d+|#L\d+)$/;

const escapeRegExp = (opts: { text: string }): string =>
  opts.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// `{}` and `*` mark a template or a glob and `<>` a placeholder, never one real file.
const BACKTICK_PATTERN = new RegExp(
  `\`((?:${SOURCE_ROOTS.map((root) => escapeRegExp({ text: root })).join('|')})[^\`{}*<>]+?\\.(?:${SOURCE_EXTENSIONS.join('|')})(?::\\d+|#L\\d+)?)\``,
  'g',
);

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
  const result = Bun.spawnSync(['git', 'ls-files', '-z'], { cwd: opts.root, timeout: 30_000 });

  if (result.exitCode !== 0) {
    throw new Error(`git ls-files failed in ${opts.root}: ${result.stderr.toString().trim()}`);
  }

  const files = new Set(result.stdout.toString().split('\0').filter(Boolean));
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

const extractPaths = (opts: { text: string; repo: string; skipProse: boolean }): string[] => {
  const github = new RegExp(
    `${escapeRegExp({ text: opts.repo })}/(?:blob|tree)/main/([^\\s)\\]"'\`<>]+)`,
    'g',
  );
  const found = [...opts.text.matchAll(github)].map((match) =>
    (match[1] ?? '').replace(LINE_SUFFIX_PATTERN, ''),
  );

  if (opts.skipProse) {
    return found;
  }

  const prose = [...opts.text.matchAll(BACKTICK_PATTERN)].map((match) =>
    (match[1] ?? '').replace(LINE_SUFFIX_PATTERN, ''),
  );

  return [...found, ...prose];
};

/** The `resource:` line of a concept's frontmatter, or none when it has no tracked prefix. */
const extractResource = (opts: { lines: string[] }): { line: number; path: string } | undefined => {
  const { lines } = opts;

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

    if (
      value !== undefined &&
      value !== '' &&
      SOURCE_ROOTS.some((root) => value.startsWith(root))
    ) {
      return { line: index + 1, path: value };
    }
  }

  return undefined;
};

/**
 * Walks the `.md` files under `directories` (paths relative to `root`) and reports every source path
 * that git does not track. `skipFiles` are generated pages that are never held to the gate.
 */
export const checkSourceLinks = (opts: {
  root: string;
  repo: string;
  directories: string[];
  skipProseUnder: string[];
  skipFiles: string[];
}): { checked: number; missing: IMissingSourceLink[] } => {
  const { root, repo, skipFiles, skipProseUnder } = opts;
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
        ? extractResource({ lines })
        : undefined;

      if (resource !== undefined) {
        checked += 1;

        if (!exists(resource.path)) {
          missing.push({ file: path, line: resource.line, path: resource.path });
        }
      }

      for (const [index, text] of lines.entries()) {
        for (const found of extractPaths({ text, repo, skipProse })) {
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
};
