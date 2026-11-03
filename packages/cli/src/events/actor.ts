import { readdirSync, readFileSync } from 'node:fs';
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
   * session registry (`<config dir>/sessions/<pid>.json`, matched by session id); `claude:` and the
   * start of the session id; `unknown`. The registry is not a documented interface, so a read that fails
   * or finds no match falls through to the next answer.
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

    return named ?? `claude:${sessionId.slice(0, SESSION_ID_SHORT)}`;
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

    for (const file of files) {
      const name = EventActor.nameIn({ file: join(directory, file), sessionId: opts.sessionId });

      if (name !== undefined) {
        return name;
      }
    }

    return undefined;
  }

  /** The name in one registry file when it is the session's; a file that cannot be read is no match. */
  private static nameIn(opts: { file: string; sessionId: string }): string | undefined {
    try {
      const entry: unknown = JSON.parse(readFileSync(opts.file, 'utf8'));

      if (!RecordValue.isRecord(entry) || entry.sessionId !== opts.sessionId) {
        return undefined;
      }

      const name = typeof entry.name === 'string' ? EventActor.clean({ text: entry.name }) : '';

      return name === '' ? undefined : name;
    } catch {
      return undefined;
    }
  }
}
