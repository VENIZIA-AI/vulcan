import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_DIRECTORY } from '../common/paths.ts';
import { ExitCodes } from '../common/index.ts';
import type { ICommandContext } from '../common/index.ts';
import { CiAffected } from './affected.ts';
import { CiChecks, CiConstants, CiFlags, CiSubcommands, CiTemplates } from './common/index.ts';
import type { IAffectedResult, TCiCheck } from './common/index.ts';

const USAGE = `usage: vulcan ci affected ${CiFlags.BASE} <ref> [${CiFlags.HEAD} <ref>] [${CiFlags.CHECK} <check>] [${CiFlags.JSON} | ${CiFlags.NAMES}]
       vulcan ci template <${[...CiTemplates.SCHEME_SET].join('|')}>
checks: ${[...CiChecks.SCHEME_SET].join(', ')}`;

/** `vulcan ci`: which packages a change touches, and the CI templates that call it. */
export class CiCommand {
  static async run(opts: ICommandContext): Promise<number> {
    const [subcommand, ...rest] = opts.args;

    if (subcommand === CiSubcommands.TEMPLATE) {
      return CiCommand.template({ args: rest });
    }

    if (subcommand === CiSubcommands.AFFECTED) {
      return CiCommand.affected({ cwd: opts.cwd, args: rest });
    }

    process.stderr.write(`ci: ${USAGE}\n`);

    return ExitCodes.USAGE;
  }

  private static template(opts: { args: string[] }): number {
    const [name, ...extra] = opts.args;

    if (name === undefined || extra.length > 0 || !CiTemplates.isValid(name)) {
      process.stderr.write(`ci: ${USAGE}\n`);

      return ExitCodes.USAGE;
    }

    process.stdout.write(
      readFileSync(
        join(BASE_DIRECTORY, CiConstants.TEMPLATE_FOLDER, CiTemplates.FILES[name]),
        'utf8',
      ),
    );

    return ExitCodes.OK;
  }

  private static affected(opts: { cwd: string; args: string[] }): number {
    const parsed = CiCommand.parse({ args: opts.args });

    if (!parsed.ok) {
      process.stderr.write(`ci: ${parsed.error}\n${USAGE}\n`);

      return ExitCodes.USAGE;
    }

    const { base, head, check, json, names } = parsed;
    const run = CiAffected.run({ root: opts.cwd, base, head });

    if (!run.ok) {
      process.stderr.write(`ci: ${run.error}\n`);

      return ExitCodes.USAGE;
    }

    const result: IAffectedResult =
      check === undefined
        ? run.result
        : {
            ...run.result,
            packages: run.result.packages.filter((entry) => entry.checks[check] !== undefined),
          };

    if (json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else if (names) {
      process.stdout.write(result.packages.map((entry) => `${entry.name}\n`).join(''));
    } else {
      process.stdout.write(CiCommand.format({ result }));
    }

    return ExitCodes.OK;
  }

  private static parse(opts: { args: string[] }):
    | {
        ok: true;
        base: string;
        head: string;
        check: TCiCheck | undefined;
        json: boolean;
        names: boolean;
      }
    | { ok: false; error: string } {
    const values: Record<string, string> = {};
    let json = false;
    let names = false;

    for (let index = 0; index < opts.args.length; index++) {
      const arg = opts.args[index];

      if (arg === CiFlags.JSON) {
        json = true;
        continue;
      }

      if (arg === CiFlags.NAMES) {
        names = true;
        continue;
      }

      const value = opts.args[index + 1];

      if (value === undefined || Object.hasOwn(values, arg) || value.startsWith('-')) {
        return { ok: false, error: `${arg} needs a value, once` };
      }

      values[arg] = value;
      index++;
    }

    const base = values[CiFlags.BASE];
    const check = values[CiFlags.CHECK];

    if (base === undefined) {
      return { ok: false, error: `${CiFlags.BASE} is required` };
    }

    if (json && names) {
      return { ok: false, error: `${CiFlags.JSON} and ${CiFlags.NAMES} cannot be combined` };
    }

    if (check !== undefined && !CiChecks.isValid(check)) {
      return {
        ok: false,
        error: `${CiFlags.CHECK} must be one of ${[...CiChecks.SCHEME_SET].join(', ')}`,
      };
    }

    return {
      ok: true,
      base,
      head: values[CiFlags.HEAD] ?? 'HEAD',
      check: check as TCiCheck | undefined,
      json,
      names,
    };
  }

  private static format(opts: { result: IAffectedResult }): string {
    const { result } = opts;
    const header =
      result.all && result.allBecause !== undefined
        ? `all packages are affected: ${result.allBecause}\n`
        : '';
    const rows = result.packages.map(
      (entry) =>
        `${entry.name}  ${entry.dir}  ${entry.reason}  ${Object.keys(entry.checks).join(',') || '-'}\n`,
    );

    return `${header}${rows.join('')}`;
  }
}
