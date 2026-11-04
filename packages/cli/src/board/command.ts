import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ExitCodes } from '../common/index.ts';
import type { ICommandContext } from '../common/index.ts';
import { EventLog } from '../events/log.ts';
import { EventSettings } from '../events/settings.ts';
import { BoardConstants, BoardFlags, BoardServe, BoardStates } from './common/index.ts';
import type { IBoardData, IBoardEvent } from './common/index.ts';
import { BoardFold } from './fold.ts';
import { BoardGithub } from './github.ts';
import { BoardSettings } from './settings.ts';
import { BoardPage } from './page.ts';
import { BoardServer } from './server.ts';

const USAGE = `usage: vulcan board [${BoardServe.COMMAND} [${BoardFlags.PORT} <n>] | ${BoardFlags.OUT} <file>] [${BoardFlags.OUT} <file>] [${BoardFlags.OPEN}] [${BoardFlags.SINCE} <date>] [${BoardFlags.DIR} <events folder>] [${BoardFlags.REPO} owner/name]... [${BoardFlags.NO_GITHUB}]`;
const REPO_NAME = /^[\w.-]+\/[\w.-]+$/;

interface IBoardArgs {
  serve: boolean;
  port: string | undefined;
  out: string | undefined;
  open: boolean;
  since: string | undefined;
  dir: string | undefined;
  repos: string[];
  noGithub: boolean;
}

/** `vulcan board`: the flows of a project, from its event log and, when `gh` can read them, its pull requests, as one HTML file. */
export class BoardCommand {
  static async run(opts: ICommandContext): Promise<number> {
    const args = BoardCommand.parse({ args: opts.args });

    if (typeof args === 'string') {
      process.stderr.write(`board: ${args}\n${USAGE}\n`);

      return ExitCodes.USAGE;
    }

    const sinceOf = (): number =>
      args.since === undefined
        ? Date.now() - BoardConstants.DEFAULT_DAYS * BoardConstants.DAY_MS
        : Date.parse(args.since);
    const since = sinceOf();

    if (!Number.isFinite(since)) {
      process.stderr.write(
        `board: ${BoardFlags.SINCE} needs a date such as 2026-11-03 or 2026-11-03T09:00:00Z\n${USAGE}\n`,
      );

      return ExitCodes.USAGE;
    }

    const root = EventSettings.rootOf({ cwd: opts.cwd });
    const dir = EventSettings.dirOf({
      root,
      ...(args.dir === undefined ? {} : { dir: resolve(opts.cwd, args.dir) }),
    });
    if (args.serve) {
      return BoardCommand.serve({ args, root, dir, sinceOf });
    }

    const data = BoardCommand.collect({ root, dir, since, args });
    const file = resolve(root, args.out ?? BoardConstants.DEFAULT_OUT);

    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, BoardPage.render({ data }));
    } catch (error) {
      process.stderr.write(
        `board: cannot write ${file}: ${error instanceof Error ? error.message : String(error)}\n`,
      );

      return ExitCodes.FAILURE;
    }

    for (const source of data.sources) {
      process.stderr.write(`board: ${source}\n`);
    }

    process.stdout.write(`${file}\n`);

    if (args.open) {
      BoardCommand.open({ target: file });
    }

    return ExitCodes.OK;
  }

  /** The folded data of a project: its log since `since`, and GitHub unless it is left out or cannot be read. */
  static collect(opts: {
    root: string;
    dir: string;
    since: number;
    args: Pick<IBoardArgs, 'repos' | 'noGithub'>;
    /** The GitHub lines to use; with none, they are read here (unless `noGithub`). */
    github?: { events: IBoardEvent[]; note: string };
  }): IBoardData {
    const read = EventLog.read({ dir: opts.dir, since: opts.since });
    const fromLog = BoardFold.fromLog({ events: read.events });
    const github =
      opts.github ??
      (opts.args.noGithub
        ? { events: [], note: 'github: left out (--no-github)' }
        : BoardGithub.read({ repos: opts.args.repos, cwd: opts.root, since: opts.since }));
    const settings = BoardSettings.read({ root: opts.root });
    const { flows, decisions } = BoardFold.fold({
      events: [...fromLog.events, ...github.events],
      owner: settings.owner,
    });

    return {
      title: settings.title,
      owner: settings.owner,
      ...(settings.logo === undefined ? {} : { logo: settings.logo }),
      key: settings.key,
      shapes: settings.shapes,
      ...(settings.roster.length === 0 ? {} : { roster: settings.roster }),
      ...(Object.keys(settings.lanes).length === 0 ? {} : { lanes: settings.lanes }),
      generatedAt: new Date().toISOString(),
      since: new Date(opts.since).toISOString(),
      flows: flows.sort(
        (left, right) =>
          BoardStates.ORDER.indexOf(left.state) - BoardStates.ORDER.indexOf(right.state) ||
          left.id.localeCompare(right.id),
      ),
      decisions,
      agents: fromLog.agents,
      sources: [
        `event log: ${read.events.length} line(s) in ${opts.dir}${read.skipped > 0 ? `, ${read.skipped} skipped` : ''}`,
        github.note,
        ...settings.notes,
      ],
    };
  }

  /** `vulcan board serve`: the board on 127.0.0.1 that updates when the log does, until Ctrl+C. */
  private static async serve(opts: {
    args: IBoardArgs;
    root: string;
    dir: string;
    sinceOf: () => number;
  }): Promise<number> {
    const { args } = opts;
    let github: { events: IBoardEvent[]; note: string } | undefined;
    let readAt = 0;
    const collect = (): IBoardData => {
      const since = opts.sinceOf();

      if (!args.noGithub && Date.now() - readAt >= BoardServe.REFRESH_MS) {
        github = BoardGithub.read({ repos: args.repos, cwd: opts.root, since });
        readAt = Date.now();
      }

      return BoardCommand.collect({
        root: opts.root,
        dir: opts.dir,
        since,
        args,
        ...(github === undefined ? {} : { github }),
      });
    };
    const port = args.port === undefined ? BoardServe.DEFAULT_PORT : Number(args.port);

    try {
      const { url, note } = await BoardServer.start({ port, dir: opts.dir, collect });

      if (note !== undefined) {
        process.stderr.write(`board: ${note}\n`);
      }

      process.stderr.write('board: serving; press Ctrl+C to stop\n');
      process.stdout.write(`${url}\n`);

      if (args.open) {
        BoardCommand.open({ target: url });
      }
    } catch (error) {
      process.stderr.write(
        `board: cannot serve: ${error instanceof Error ? error.message : String(error)}\n`,
      );

      return ExitCodes.FAILURE;
    }

    await new Promise<void>((done) => {
      process.once('SIGINT', () => done());
      process.once('SIGTERM', () => done());
    });
    await BoardServer.stop();

    return ExitCodes.OK;
  }

  private static parse(opts: { args: string[] }): IBoardArgs | string {
    const parsed: IBoardArgs = {
      serve: false,
      port: undefined,
      out: undefined,
      open: false,
      since: undefined,
      dir: undefined,
      repos: [],
      noGithub: false,
    };
    const keys: Record<string, 'out' | 'port' | 'since' | 'dir'> = {
      [BoardFlags.OUT]: 'out',
      [BoardFlags.PORT]: 'port',
      [BoardFlags.SINCE]: 'since',
      [BoardFlags.DIR]: 'dir',
    };

    const words = opts.args[0] === BoardServe.COMMAND ? opts.args.slice(1) : opts.args;

    parsed.serve = words !== opts.args;

    for (let index = 0; index < words.length; index++) {
      const arg = words[index];

      if (arg === BoardFlags.OPEN) {
        parsed.open = true;
        continue;
      }

      if (arg === BoardFlags.NO_GITHUB) {
        parsed.noGithub = true;
        continue;
      }

      if (!arg.startsWith('-')) {
        return `unknown argument '${arg}'`;
      }

      const value = words[index + 1];

      if (value === undefined || value.startsWith('-')) {
        return `${arg} needs a value`;
      }

      index++;

      if (arg === BoardFlags.REPO) {
        if (!REPO_NAME.test(value)) {
          return `${BoardFlags.REPO} must look like owner/name, got '${value}'`;
        }

        parsed.repos.push(value);
        continue;
      }

      const key = keys[arg];

      if (key === undefined || parsed[key] !== undefined) {
        return `${arg} is unknown or given twice`;
      }

      parsed[key] = value;
    }

    if (parsed.serve && parsed.out !== undefined) {
      return `${BoardFlags.OUT} writes the static file; ${BoardServe.COMMAND} serves the board`;
    }

    if (!parsed.serve && parsed.port !== undefined) {
      return `${BoardFlags.PORT} belongs to ${BoardServe.COMMAND}`;
    }

    if (
      parsed.port !== undefined &&
      !(/^\d{1,5}$/.test(parsed.port) && Number(parsed.port) <= 65_535)
    ) {
      return `${BoardFlags.PORT} must be a number from 0 to 65535, got '${parsed.port}'`;
    }

    return parsed;
  }

  private static open(opts: { target: string }): void {
    const program =
      process.platform === 'darwin'
        ? 'open'
        : process.platform === 'win32'
          ? 'explorer.exe'
          : 'xdg-open';
    const args = [opts.target];
    const hint = `board: could not open it; open ${opts.target} yourself\n`;

    try {
      const child = spawn(program, args, { detached: true, stdio: 'ignore' });

      child.on('error', () => process.stderr.write(hint));
      child.unref();
    } catch {
      process.stderr.write(hint);
    }
  }
}
