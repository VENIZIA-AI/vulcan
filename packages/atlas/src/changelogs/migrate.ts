import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { IAtlasProject } from '@/common/project-config';
import { resolveChangelogPackages, splitFrontmatter } from './resolve';

const DATED_ENTRY = /^\d{4}-\d{2}-\d{2}-.*\.md$/;
const FRONTMATTER_BLOCK = /^---\r?\n([\s\S]*?)\r?\n---/;

export interface IMigrateReport {
  /** Entries given a `packages:` list (written, or would be on a dry run). */
  written: string[];
  /** Entries nothing resolved for: a human declares their packages. */
  unresolved: string[];
  /** Entries that already declared a list - never touched. */
  declared: number;
}

/** The entry with `line` added as the last frontmatter key, or a frontmatter of its own - in its own line endings. */
const withFrontmatterLine = (opts: { text: string; line: string }): string => {
  const block = FRONTMATTER_BLOCK.exec(opts.text);
  const eol = opts.text.includes('\r\n') ? '\r\n' : '\n';

  return block === null
    ? `---${eol}${opts.line}${eol}---${eol}${eol}${opts.text}`
    : `---${eol}${block[1]}${eol}${opts.line}${eol}---${opts.text.slice(block[0].length)}`;
};

/**
 * Project Contract v1, C3: writes `packages: [<npm name>, ...]` into every dated changelog entry
 * that declares none, from what today's resolution finds (frontmatter, a Package column, npm-name
 * mentions, `packages/<dir>` paths). A declared list is never overwritten; what resolves to nothing
 * is reported for a human. `write: false` reports without writing.
 */
export const migrateChangelogs = (opts: {
  project: IAtlasProject;
  write: boolean;
}): IMigrateReport => {
  const { project } = opts;
  const directory = project.knowledge.changelogs;
  const report: IMigrateReport = { written: [], unresolved: [], declared: 0 };

  if (directory === undefined || !existsSync(directory)) {
    return report;
  }

  for (const file of readdirSync(directory)
    .filter((name) => DATED_ENTRY.test(name))
    .sort()) {
    const path = join(directory, file);
    const text = readFileSync(path, 'utf8');
    const shown = relative(project.root, path);

    if ('packages' in splitFrontmatter(text).data) {
      report.declared += 1;
      continue;
    }

    const names = resolveChangelogPackages({ text, packages: project.packages }).map(
      (dir) => project.packages.find((entry) => entry.dir === dir)?.name ?? dir,
    );

    if (names.length === 0) {
      report.unresolved.push(shown);
      continue;
    }

    if (opts.write) {
      const line = `packages: [${names.map((name) => `'${name}'`).join(', ')}]`;

      writeFileSync(path, withFrontmatterLine({ text, line }));
    }

    report.written.push(shown);
  }

  return report;
};
