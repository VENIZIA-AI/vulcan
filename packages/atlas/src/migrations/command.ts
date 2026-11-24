import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VersionFolders } from '@/changelogs/version-folder';
import { VersionNotes } from '@/changelogs/notes';
import { ProjectConfig } from '@/common/project-config';
import { ChangelogCheck } from './check';
import { ChangelogHistory } from './history';

const USAGE =
  'usage: vulcan atlas changelogs check [--history --base <ref>] | notes --version <X.Y.Z> [--migration]';

/**
 * `changelogs notes --version <X.Y.Z>`: the release notes of a version folder (its `log.md` and the packages of the
 * project). With `--migration` it prints instead the path of the folder's `migration.yaml` when that file holds a block,
 * and nothing when it does not: what a workflow attaches to the Release.
 */
const runNotes = (opts: { args: string[] }): number => {
  const [flag, version, ...rest] = opts.args;
  const isMigration = rest.length === 1 && rest[0] === '--migration';

  if (
    flag !== '--version' ||
    version === undefined ||
    !VersionFolders.isName({ name: version }) ||
    (rest.length > 0 && !isMigration)
  ) {
    console.error(USAGE);

    return 2;
  }

  const project = ProjectConfig.readAtlasProject();
  const directory = project.knowledge.changelogs;
  const logFile = directory === undefined ? undefined : join(directory, version, 'log.md');

  if (directory === undefined || logFile === undefined || !existsSync(logFile)) {
    console.error(`changelogs notes: no changelogs/${version}/log.md in this project`);

    return 1;
  }

  const migrationFile = join(directory, version, 'migration.yaml');
  const migration = existsSync(migrationFile) ? readFileSync(migrationFile, 'utf8') : undefined;

  if (isMigration) {
    if (VersionNotes.hasBlocks({ migration })) {
      process.stdout.write(`${migrationFile}\n`);
    }

    return 0;
  }

  process.stdout.write(
    VersionNotes.notesOf({
      log: readFileSync(logFile, 'utf8'),
      names: project.packages.filter((entry) => !entry.retired).map((entry) => entry.name),
      version,
    }),
  );

  return 0;
};

/** `vulcan atlas changelogs check`: the gate over the changelog entries' `migration` blocks. */
export const runChangelogsCommand = (opts: { command?: string; args?: string[] }): number => {
  const args = opts.args ?? [];

  if (opts.command === 'notes') {
    return runNotes({ args });
  }

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
