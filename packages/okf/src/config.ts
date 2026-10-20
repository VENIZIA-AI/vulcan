/**
 * config.ts - okf's constants that hold for every project. Everything project-specific (paths,
 * packages, renderers, regions, sections, coverage axes, denylist, the explorer's brand and copy)
 * comes from the project config `vulcan x` hands okf - see project/reader.ts.
 */

/** Directories never walked when scanning source. */
export const PRUNE_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  '.turbo',
  'coverage',
  '.cache',
  '.vitepress',
  '.claude',
  '__tests__',
]);

/** Reserved OKF filenames that carry no `type:` frontmatter and are never counted as concepts. */
export const RESERVED_FILES = new Set(['index.md', 'log.md']);

/** What a stale check tells the person: the tool command works in any project, a make target may not exist. */
export const REGENERATE_HINT = 'run `vulcan x okf gen`';
