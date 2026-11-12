import { ProjectConfig } from '@/common/project-config';
import { ChangelogCheck } from './check';

const USAGE = 'usage: vulcan x atlas changelogs check';

/** `vulcan x atlas changelogs check`: the gate over the changelog entries' `migration` blocks. */
export const runChangelogsCommand = (opts: { command?: string; args?: string[] }): number => {
  if (opts.command !== 'check' || (opts.args ?? []).length > 0) {
    console.error(USAGE);

    return 2;
  }

  return ChangelogCheck.run({
    project: ProjectConfig.readAtlasProject(),
    write: (text) => {
      process.stderr.write(text);
    },
  });
};
