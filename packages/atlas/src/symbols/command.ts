import { AtlasSymbols } from './generator';

/** `vulcan atlas symbols`: prints the symbol records, a debug view. */
export class SymbolsCommand {
  static run(opts: { command?: string }): number {
    // A flag is ignored, as it always was; a word is a subcommand that does not exist.
    if (opts.command !== undefined && !opts.command.startsWith('-')) {
      console.error(`usage: vulcan atlas symbols (no subcommand: '${opts.command}' is not one)`);

      return 2;
    }

    process.stdout.write(AtlasSymbols.render());

    return 0;
  }
}
