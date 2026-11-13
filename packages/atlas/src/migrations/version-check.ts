import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VersionFolders, VersionSections } from '@/changelogs/version-folder';
import type { IVersionFolder } from '@/changelogs/version-folder';
import type { IAtlasProject } from '@/common/project-config';
import type { IChangelogProblem } from './check';

const PRERELEASE_PART = /-.+$/;

/**
 * The gate over the version folders `changelogs/<X.Y.Z>/{log.md, migration.yaml}`, from the files alone (no git):
 * what makes one valid, and the one-in-progress rule. The rules that need history are `ChangelogHistory`'s.
 */
export class VersionCheck {
  static scan(opts: { project: IAtlasProject; codemods?: string[] }): IChangelogProblem[] {
    const { changelogs: directory } = opts.project.knowledge;

    if (directory === undefined) {
      return [];
    }

    const folders = VersionFolders.read({ directory });

    return [
      ...folders.flatMap((folder) =>
        VersionCheck.folderProblems({ folder, codemods: opts.codemods }),
      ),
      ...VersionCheck.progressProblems({ project: opts.project, folders }),
    ];
  }

  private static folderProblems(opts: {
    folder: IVersionFolder;
    codemods?: string[];
  }): IChangelogProblem[] {
    const { folder } = opts;
    const problems: IChangelogProblem[] = [...folder.problems];
    const fail = (file: string, message: string): void => {
      problems.push({ file: `${folder.name}/${file}`, message });
    };
    const owing = folder.items.filter((item) => VersionSections.OWING.includes(item.section));
    const known = new Set(folder.items.map((item) => item.id));

    for (const item of owing) {
      if (folder.blocks[item.id] === undefined) {
        fail(
          'migration.yaml',
          `'${item.id}' is a ${item.section} item (log.md line ${item.line}) and needs a block: how an app upgrades and downgrades across it`,
        );
      }
    }

    for (const id of Object.keys(folder.blocks)) {
      if (!known.has(id)) {
        fail('migration.yaml', `'${id}' has a block but no item in log.md`);
      } else if (!owing.some((item) => item.id === id)) {
        fail('migration.yaml', `'${id}' is not a Breaking or Deprecated item: it carries no block`);
      }
    }

    VersionCheck.codemodProblems({ folder, codemods: opts.codemods, fail });

    return problems;
  }

  private static codemodProblems(opts: {
    folder: IVersionFolder;
    codemods?: string[];
    fail: (file: string, message: string) => void;
  }): void {
    if (opts.codemods === undefined) {
      return;
    }

    for (const [id, block] of Object.entries(opts.folder.blocks)) {
      const codemod =
        typeof block === 'object' && block !== null && 'codemod' in block
          ? block.codemod
          : undefined;

      if (typeof codemod === 'string' && !opts.codemods.includes(codemod)) {
        opts.fail(
          'migration.yaml',
          `'${id}' names codemod '${codemod}', which \`devz codemod --list\` does not offer`,
        );
      }
    }
  }

  /** At most one folder lacks `released:`; it is above every released one and is the stable the installable package heads to. */
  private static progressProblems(opts: {
    project: IAtlasProject;
    folders: IVersionFolder[];
  }): IChangelogProblem[] {
    const problems: IChangelogProblem[] = [];
    const open = opts.folders.filter((folder) => folder.released === undefined);
    const released = opts.folders.filter((folder) => folder.released !== undefined);

    if (open.length > 1) {
      problems.push({
        file: open.map((folder) => folder.name).join(', '),
        message:
          'more than one version folder has no `released:` date: only the line in progress may lack it',
      });
    }

    for (const folder of open) {
      for (const done of released) {
        if (Bun.semver.order(folder.name, done.name) <= 0) {
          problems.push({
            file: `${folder.name}/log.md`,
            message: `${folder.name} is in progress but ${done.name} is released and not older: a line in progress is above every released one`,
          });
        }
      }
    }

    const heading = VersionCheck.installableStable({ project: opts.project });

    if (heading === undefined || opts.folders.length === 0) {
      return problems;
    }

    if (open.length === 1 && open[0].name !== heading.stable) {
      problems.push({
        file: `${open[0].name}/log.md`,
        message: `the line in progress is ${open[0].name} but ${heading.name} is at ${heading.version}, heading to ${heading.stable}`,
      });
    }

    if (open.length === 0 && PRERELEASE_PART.test(heading.version)) {
      problems.push({
        file: `${heading.stable}/log.md`,
        message: `${heading.name} is at the prerelease ${heading.version}: its line ${heading.stable} needs a version folder`,
      });
    }

    return problems;
  }

  /** The last live package of the project is the one users install; its `package.json` version says which stable the line heads to. */
  private static installableStable(opts: {
    project: IAtlasProject;
  }): { name: string; version: string; stable: string } | undefined {
    const live = opts.project.packages.filter((entry) => !entry.retired);
    const installable = live.at(-1);

    if (installable === undefined) {
      return undefined;
    }

    const file = join(opts.project.root, installable.path, 'package.json');

    if (!existsSync(file)) {
      return undefined;
    }

    try {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
      const version =
        typeof parsed === 'object' && parsed !== null && 'version' in parsed
          ? parsed.version
          : undefined;

      return typeof version === 'string'
        ? { name: installable.name, version, stable: version.replace(PRERELEASE_PART, '') }
        : undefined;
    } catch {
      return undefined;
    }
  }
}
