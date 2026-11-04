import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { RecordValue } from '../common/record.ts';
import { EventConstants } from './common/index.ts';
import { EventText } from './text.ts';

const SESSION_FILE = /^[\w.-]+\.json$/;
const SESSION_ID_SHORT = 8;
/** A person has a handful of sessions; a folder with more is not the registry this expects. */
const MAX_SESSION_FILES = 500;

/** Who is writing: the session's name, the way other sessions address it. */
export class EventActor {
  /**
   * In order: `VULCAN_ACTOR` from the environment; the name Claude Code gave the session in its own
   * session registry (`<config dir>/sessions/<pid>.json`, matched by session id) when a person or a peer
   * gave it; `claude:` and the start of the session id; `unknown`. The registry is not a documented interface,
   * so a read that fails or finds no match falls through to the next answer.
   */
  static resolve(opts: { sessionId?: string; env: Record<string, string | undefined> }): string {
    const fromEnv = EventActor.clean({ text: opts.env[EventConstants.ACTOR_ENV] ?? '' });

    if (fromEnv !== '') {
      return fromEnv;
    }

    const { sessionId } = opts;

    if (sessionId === undefined || sessionId === '') {
      return EventConstants.UNKNOWN_ACTOR;
    }

    const named = EventActor.registryName({ sessionId, env: opts.env });

    return named ?? `${EventConstants.UNNAMED_PREFIX}${sessionId.slice(0, SESSION_ID_SHORT)}`;
  }

  static clean(opts: { text: string }): string {
    return EventText.oneLine({ text: opts.text, max: EventConstants.ACTOR_MAX });
  }

  private static registryName(opts: {
    sessionId: string;
    env: Record<string, string | undefined>;
  }): string | undefined {
    const config = opts.env[EventConstants.CONFIG_DIR_ENV] ?? join(homedir(), '.claude');
    const directory = join(config, 'sessions');

    let files: string[];

    try {
      files = readdirSync(directory)
        .filter((name) => SESSION_FILE.test(name))
        .slice(0, MAX_SESSION_FILES);
    } catch {
      return undefined;
    }

    const matches = files.flatMap(
      (file) =>
        EventActor.candidateIn({ file: join(directory, file), sessionId: opts.sessionId }) ?? [],
    );
    // Several files can hold one session id (a resumed session leaves its old file): a live process wins, then the newest.
    const live = matches.filter((match) => match.alive);
    const best = [...(live.length > 0 ? live : matches)].sort(
      (left, right) => right.updatedAt - left.updatedAt,
    )[0];

    return best?.name;
  }

  /** The name, the process and the time of one registry file when it is the session's; a file that cannot be read is no match. */
  private static candidateIn(opts: {
    file: string;
    sessionId: string;
  }): { name: string; alive: boolean; updatedAt: number }[] | undefined {
    try {
      const entry: unknown = JSON.parse(readFileSync(opts.file, 'utf8'));

      if (!RecordValue.isRecord(entry) || entry.sessionId !== opts.sessionId) {
        return undefined;
      }

      const name = typeof entry.name === 'string' ? EventActor.clean({ text: entry.name }) : '';

      // A name with no readable source counts as given: hiding a real agent is the worse mistake.
      if (
        name === '' ||
        (typeof entry.nameSource === 'string' &&
          EventConstants.MADE_UP_NAME_SOURCES.has(entry.nameSource))
      ) {
        return undefined;
      }

      return [
        {
          name,
          alive: typeof entry.pid === 'number' && EventActor.isAlive({ pid: entry.pid }),
          updatedAt:
            typeof entry.updatedAt === 'number'
              ? entry.updatedAt
              : Number(statSync(opts.file).mtimeMs),
        },
      ];
    } catch {
      return undefined;
    }
  }

  /** Whether a process with this id exists (signal 0 sends nothing); a process of another user exists too. */
  private static isAlive(opts: { pid: number }): boolean {
    try {
      process.kill(opts.pid, 0);

      return true;
    } catch (error) {
      return error instanceof Error && 'code' in error && error.code === 'EPERM';
    }
  }
}
