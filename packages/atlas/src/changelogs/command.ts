import { readAtlasProject } from '@/common/project-config';
import { migrateChangelogs } from './migrate';

const DRY_RUN_FLAG = '--dry-run';

/** `vulcan x atlas changelogs migrate [--dry-run]` - one pass, for a human to review the diff. */
export const runChangelogsCommand = (opts: { command?: string; argv: string[] }): number => {
  if (opts.command !== 'migrate') {
    console.error('usage: vulcan x atlas changelogs migrate [--dry-run]');

    return 2;
  }

  const write = !opts.argv.includes(DRY_RUN_FLAG);
  const report = migrateChangelogs({ project: readAtlasProject(), write });
  const verb = write ? 'wrote' : 'would write';

  for (const file of report.written) {
    console.log(`changelogs: ${verb} packages into ${file}`);
  }

  for (const file of report.unresolved) {
    console.log(`changelogs: ${file} names no package - declare its packages by hand`);
  }

  console.log(
    `changelogs: ${report.written.length} ${verb}, ${report.unresolved.length} to declare by hand, ${report.declared} already declared`,
  );

  return 0;
};
