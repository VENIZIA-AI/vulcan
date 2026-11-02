import { spawnSync } from 'node:child_process';
import { TextValue } from '../common/text.ts';
import { ProjectPackages } from '../config/index.ts';
import type { ICheckContext } from './checks.ts';
import { DoctorChecks } from './common/index.ts';
import type { IViolation } from './common/index.ts';

/** The tag pattern as a regular expression that captures `<dir>`. */
const tagPatternOf = (opts: { template: string }): RegExp =>
  new RegExp(
    `^${opts.template
      .split(/(<(?:dir|version|date)>)/)
      .map((part) => {
        switch (part) {
          case '<dir>': {
            return '(?<dir>[a-z0-9][a-z0-9.-]*)';
          }

          case '<version>': {
            return '\\S+';
          }

          case '<date>': {
            return '\\d{4}-\\d{2}-\\d{2}';
          }

          default: {
            return TextValue.escapeLiteral({ text: part });
          }
        }
      })
      .join('')}$`,
  );

export class TagCheck {
  /**
   * Project Contract v1, C4: every tag `atlas.tagPattern` reads names a declared package - by
   * directory or alias, retired ones included - because atlas computes releases from the tags. A tag
   * of an old layout is ignored through `atlas.ignoreTags`. A repo-level pattern (no `<dir>`) has
   * nothing to check; a directory that is not a git repository has no tags.
   */
  static check(opts: ICheckContext): IViolation[] {
    const template = opts.config.atlas.tagPattern;

    if (!template.includes('<dir>')) {
      return [];
    }

    const listed = spawnSync('git', ['tag', '--list'], { cwd: opts.root, encoding: 'utf8' });

    if (listed.status !== 0) {
      return [];
    }

    const pattern = tagPatternOf({ template });
    const ignored = (opts.config.atlas.ignoreTags ?? []).map((glob) => new Bun.Glob(glob));
    const names = new Set(
      ProjectPackages.resolve({ config: opts.config }).flatMap((entry) => [
        entry.dir,
        ...entry.aliases,
      ]),
    );

    return listed.stdout
      .split('\n')
      .filter((tag) => tag.length > 0 && !ignored.some((glob) => glob.match(tag)))
      .flatMap((tag) => {
        const dir = pattern.exec(tag)?.groups?.dir;

        return dir === undefined || names.has(dir)
          ? []
          : [
              {
                check: DoctorChecks.TAGS,
                file: 'git tags',
                message: `tag ${tag} reads as a release of '${dir}', which no package declares - declare it (retired: true if it is gone), add it as an alias, or ignore the tag (atlas.ignoreTags)`,
              },
            ];
      });
  }
}
