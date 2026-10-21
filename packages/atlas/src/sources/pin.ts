import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { IAtlasProject } from '@/common/project-config';
import type { IReleaseRecord, IReleaseTable } from '@/releases/common';
import { compileReleaseTemplate } from '@/releases/template';

export type TPinDecision =
  | { pinned: true; tag: string; basis: string }
  | { pinned: false; reason: string };

interface IInstalled {
  name: string;
  dir: string;
  version: string;
  record: IReleaseRecord;
}

const NODE_MODULES = `${sep}node_modules${sep}`;

/** A package linked in from outside any node_modules (a `file:` or workspace link) is code under work, not a release. */
const isLinked = (opts: { directory: string }): boolean =>
  lstatSync(opts.directory).isSymbolicLink() &&
  !`${realpathSync(opts.directory)}${sep}`.includes(NODE_MODULES);

const versionAt = (opts: { directory: string }): string | undefined => {
  try {
    const manifest = JSON.parse(readFileSync(join(opts.directory, 'package.json'), 'utf8'));

    return typeof manifest.version === 'string' ? manifest.version : undefined;
  } catch {
    return undefined;
  }
};

/** The tag a release of `dir` at `version` carries, from the project's `tagPattern`; undefined when the template cannot name one. */
const tagOf = (opts: { template: string; dir: string; version: string }): string | undefined => {
  const tag = opts.template
    .replaceAll('<dir>', opts.dir)
    .replaceAll('<package>', opts.dir)
    .replaceAll('<version>', opts.version);

  // A placeholder left over (`<issue>`, `<date>`), or a name the template does not read back as this release.
  return /<[a-z]+>/.test(tag) ||
    compileReleaseTemplate({ template: opts.template }).exec(tag)?.groups?.version !== opts.version
    ? undefined
    : tag;
};

/**
 * What the corpus of a source should be read at: the release tag of the newest installed package of
 * the source. "Newest" is by release order in the source's history, so the docs describe the latest
 * state of anything the project runs. Nothing is pinned when no package is installed, an installed one
 * is a link, or its version has no recorded release; the reason says which.
 */
export const decidePin = (opts: {
  cwd: string;
  project: IAtlasProject;
  table: IReleaseTable;
}): TPinDecision => {
  const found: IInstalled[] = [];
  const problems: string[] = [];

  for (const entry of opts.project.packages.filter(item => !item.retired)) {
    const directory = join(opts.cwd, 'node_modules', entry.name);

    if (!existsSync(join(directory, 'package.json'))) {
      continue;
    }

    if (isLinked({ directory })) {
      problems.push(`${entry.name} is linked (a file: or workspace package), not a release`);
      continue;
    }

    const version = versionAt({ directory });
    const record = opts.table.releases[entry.dir]?.find(release => release.version === version);

    if (version === undefined || record === undefined) {
      problems.push(`no release of ${entry.name} ${version ?? '(no version)'} is recorded`);
      continue;
    }

    found.push({ name: entry.name, dir: entry.dir, version, record });
  }

  if (found.length === 0) {
    return {
      pinned: false,
      reason:
        problems.length === 0 ? 'none of its packages is installed here' : problems.join('; '),
    };
  }

  // Release order in the first-parent history; a table older than 0.2.0-0 has none, and the date stands in.
  const newest = found.reduce((best, item) =>
    (item.record.order ?? -1) > (best.record.order ?? -1) ||
    ((item.record.order ?? -1) === (best.record.order ?? -1) && item.record.date > best.record.date)
      ? item
      : best,
  );
  const tag = tagOf({
    template: opts.project.tagPattern,
    dir: newest.dir,
    version: newest.version,
  });

  if (tag === undefined) {
    return {
      pinned: false,
      reason: `tagPattern ${opts.project.tagPattern} cannot name the tag of ${newest.name} ${newest.version}`,
    };
  }

  const others = found.filter(item => item !== newest);

  return {
    pinned: true,
    tag,
    basis: `installed ${newest.name} ${newest.version}${
      others.length === 0
        ? ''
        : ` (the newest of ${found.map(item => `${item.name} ${item.version}`).join(', ')})`
    }`,
  };
};
