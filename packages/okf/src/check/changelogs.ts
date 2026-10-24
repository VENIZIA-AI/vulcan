import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readOkfProject } from '../project/index.ts';
import type { IOkfProject } from '../project/index.ts';

const DATED_ENTRY = /^\d{4}-\d{2}-\d{2}-.*\.md$/;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;
/** `'<npm name>@<version>'` - the name may be scoped, so the version is after the LAST `@`. */
const RELEASE_OVERRIDE = /^(.+)@([^@]+)$/;

type TRecord = Record<string, unknown>;

const isRecord = (opts: { value: unknown }): opts is { value: TRecord } =>
  typeof opts.value === 'object' && opts.value !== null && !Array.isArray(opts.value);

const frontmatterOf = (opts: { text: string }): TRecord => {
  const block = FRONTMATTER.exec(opts.text)?.[1];
  const parsed = { value: block === undefined ? undefined : Bun.YAML.parse(block) };

  return isRecord(parsed) ? parsed.value : {};
};

/** The tag a release override names, by the project's template; a `<date>` part matches any date. */
const tagPatternOf = (opts: { project: IOkfProject; dir: string; version: string }): RegExp => {
  const escaped = opts.project.tagPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  return new RegExp(
    `^${escaped
      .replace(/<(?:dir|package)>/g, opts.dir)
      .replace(/<version>/g, opts.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .replace(/<date>/g, '\\d{4}-\\d{2}-\\d{2}')}$`,
  );
};

/** `git tag`, read once, only when an override needs it. */
const tagsOf = (opts: { root: string }): string[] => {
  const result = spawnSync('git', ['tag', '--list'], { cwd: opts.root, encoding: 'utf8' });

  return result.status === 0
    ? (result.stdout ?? '').split('\n').filter((tag) => tag.length > 0)
    : [];
};

/**
 * Project Contract v1, C3: every dated changelog entry declares the packages it covers by npm name -
 * atlas reads that list and never the prose. An optional `release: '<npm name>@<version>'` places an
 * entry git would place wrong (a backfill); it must name a tag that exists.
 */
export const collectChangelogProblems = (): string[] => {
  const project = readOkfProject();
  const directory = project.changelogs;

  if (directory === undefined || !existsSync(directory)) {
    return [];
  }

  const names = new Map(project.packages.map((entry) => [entry.name, entry.dir]));
  const problems: string[] = [];
  let tags: string[] | undefined;

  for (const file of readdirSync(directory)
    .filter((name) => DATED_ENTRY.test(name))
    .sort()) {
    const path = relative(project.root, join(directory, file));
    let frontmatter: TRecord;

    // One broken entry is one problem; the rest of the directory is still checked.
    try {
      frontmatter = frontmatterOf({ text: readFileSync(join(directory, file), 'utf8') });
    } catch (error) {
      problems.push(
        `changelog: ${path}: the frontmatter is not valid YAML (${error instanceof Error ? error.message : String(error)})`,
      );
      continue;
    }

    // `packages: []` is a decision - an entry about no package, such as repository tooling. Only a
    // missing list is undecided.
    if (!Array.isArray(frontmatter.packages)) {
      problems.push(
        `changelog: ${path} declares no packages - add \`packages: [<npm name>, ...]\` (\`vulcan x atlas changelogs migrate\` fills it)`,
      );
      continue;
    }

    const declared: unknown[] = frontmatter.packages;

    for (const name of declared) {
      if (typeof name !== 'string' || !names.has(name)) {
        problems.push(
          `changelog: ${path} names '${String(name)}', not a declared package's npm name`,
        );
      }
    }

    if (typeof frontmatter.release !== 'string') {
      continue;
    }

    const override = RELEASE_OVERRIDE.exec(frontmatter.release);
    const dir = override === null ? undefined : names.get(override[1]);

    if (override === null || dir === undefined) {
      problems.push(
        `changelog: ${path}: release '${frontmatter.release}' is not '<declared npm name>@<version>'`,
      );
      continue;
    }

    tags ??= tagsOf({ root: project.root });

    const pattern = tagPatternOf({ project, dir, version: override[2] });

    if (!tags.some((tag) => pattern.test(tag))) {
      const expected = project.tagPattern
        .replace(/<(?:dir|package)>/g, dir)
        .replace(/<version>/g, override[2])
        .replace(/<date>/g, 'YYYY-MM-DD');

      problems.push(
        `changelog: ${path}: release '${frontmatter.release}' names no tag (${expected})`,
      );
    }
  }

  return problems;
};
