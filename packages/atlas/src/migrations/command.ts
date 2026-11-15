import { ProjectConfig } from '@/common/project-config';
import { ChangelogCheck } from './check';
import { ChangelogHistory } from './history';

const USAGE = 'usage: vulcan x atlas changelogs check [--history --base <ref>]';

/** `vulcan x atlas changelogs check`: the gate over the changelog entries' `migration` blocks. */
export const runChangelogsCommand = (opts: { command?: string; args?: string[] }): number => {
  const args = opts.args ?? [];
  const isHistory = args[0] === '--history';
  const isShape =
    args.length === 0 || (isHistory && args.length === 3 && args[1] === '--base' && args[2] !== '');

  if (opts.command !== 'check' || !isShape) {
    console.error(USAGE);

    return 2;
  }

  const project = ProjectConfig.readAtlasProject();
  const write = (text: string): void => {
    process.stderr.write(text);
  };
  const code = ChangelogCheck.run({ project, write });

  if (!isHistory) {
    return code;
  }

  const problems = ChangelogHistory.scan({ project, base: args[2] });

  for (const problem of problems) {
    write(`${problem.file}: ${problem.message}\n`);
  }

  return code === 0 && problems.length === 0 ? 0 : 1;
};
