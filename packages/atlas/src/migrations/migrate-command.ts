import { MigrateReport } from './report';
import type { IMigrationResult } from './plan';

const USAGE =
  'usage: vulcan x atlas migrate plan [--package <name>] [--from <version>] --to <version|latest|next> [--app <dir>] [--format md|json]';

const VALUE_FLAGS = new Set([
  '--package',
  '--from',
  '--to',
  '--app',
  '--format',
  // Read by the server this command asks, not by the plan.
  '--root',
  '--source',
  '--cache-dir',
]);
const SWITCH_FLAGS = new Set(['--no-prebuilt']);
const FORMATS = new Set(['md', 'json']);

interface IParsed {
  values: Record<string, string>;
}

const parse = (opts: { args: string[] }): IParsed | undefined => {
  const [subcommand, ...rest] = opts.args;
  const values: Record<string, string> = {};

  if (subcommand !== 'plan') {
    return undefined;
  }

  for (let index = 0; index < rest.length; index++) {
    const [flag, joined] = rest[index].split(/=(.*)/s);
    const value = joined ?? rest[index + 1];

    if (SWITCH_FLAGS.has(flag)) {
      continue;
    }

    if (
      !VALUE_FLAGS.has(flag) ||
      value === undefined ||
      (joined === undefined && value.startsWith('--'))
    ) {
      return undefined;
    }

    values[flag] = value;
    index += joined === undefined ? 1 : 0;
  }

  if (values['--to'] === undefined || !FORMATS.has(values['--format'] ?? 'md')) {
    return undefined;
  }

  return { values };
};

interface IReply {
  result?: { content?: { text?: string }[] };
  error?: { message?: string };
}

/** `vulcan x atlas migrate plan`: the `migrate` tool, asked through the server the project serves. */
export class MigrateCommand {
  /**
   * Parses the flags, sends one `tools/call` through `send` (the server's transport, so a package
   * from any source answers) and prints the plan as Markdown or JSON. Exit 0 on a plan, 1 when the
   * tool refuses, 2 on a usage error.
   */
  static async run(opts: {
    args: string[];
    send: (line: string) => Promise<string | null>;
    out: (text: string) => void;
    err: (text: string) => void;
  }): Promise<number> {
    const parsed = parse({ args: opts.args });

    if (parsed === undefined) {
      opts.err(`${USAGE}\n`);

      return 2;
    }

    const { values } = parsed;
    const line = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'migrate',
        arguments: {
          package: values['--package'],
          from: values['--from'],
          to: values['--to'],
          app: values['--app'],
        },
      },
    });
    const raw = await opts.send(line);
    const reply: IReply = JSON.parse(raw ?? '{}');
    const text = reply.result?.content?.[0]?.text;

    if (text === undefined) {
      opts.err(`vulcan-atlas: ${reply.error?.message ?? 'the migrate tool gave no answer'}\n`);

      return 1;
    }

    // The tool's own JSON, read back: one answer for every door.
    const result: IMigrationResult = JSON.parse(text);

    opts.out(
      values['--format'] === 'json'
        ? `${JSON.stringify(result, null, 2)}\n`
        : MigrateReport.markdown({ result }),
    );

    return 0;
  }
}
