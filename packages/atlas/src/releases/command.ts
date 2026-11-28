import { AtlasReleases } from './generator';

/** `vulcan atlas releases`: prints the release table, a debug view. */
export class ReleasesCommand {
  static run(opts: { command?: string }): number {
    // A flag is ignored, as it always was; a word is a subcommand that does not exist.
    if (opts.command !== undefined && !opts.command.startsWith('-')) {
      console.error(`usage: vulcan atlas releases (no subcommand: '${opts.command}' is not one)`);

      return 2;
    }

    process.stdout.write(AtlasReleases.render());

    return 0;
  }
}
