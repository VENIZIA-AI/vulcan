import { readSync } from 'node:fs';

import { menusAvailable, promptSelect, promptText } from '../ui/index.ts';
import { AppSides, CreateConstants, CreateFlags } from './common/index.ts';
import type {
  IAskOptions,
  INameField,
  TAppSide,
  TAsk,
  TByteReader,
  TNamesResult,
} from './common/index.ts';

/** The folder holding every app of one side; `add` offers the one the config already holds. */
export const SIDE_FIELDS: Record<TAppSide, INameField> = {
  [AppSides.BACKEND]: {
    key: 'folder',
    flag: CreateFlags.BACKEND_DIR,
    question: 'Backend folder (holds every backend app)',
  },
  [AppSides.FRONTEND]: {
    key: 'folder',
    flag: CreateFlags.FRONTEND_DIR,
    question: 'Frontend folder (holds every frontend app)',
  },
};

export const readFlag = (opts: { args: string[]; flag: string }): string | undefined => {
  const index = opts.args.indexOf(opts.flag);

  return index === -1 ? undefined : opts.args[index + 1];
};

const isValidName = (opts: { name: string }): boolean =>
  CreateConstants.NAME_PATTERN.test(opts.name);

/** The message a menu shows under a typed name that is not one; nothing when it is fine. */
export const nameProblem = (opts: { name: string }): string | undefined =>
  isValidName({ name: opts.name })
    ? undefined
    : `'${opts.name}' is not a name: lowercase letters, digits and '-', starting with a letter or digit`;

const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const RETRY_PAUSE_MILLISECONDS = 5;

const readFromDescriptor: TByteReader = opts => readSync(opts.descriptor, opts.buffer, 0, 1, null);

/** A sleep that does not burn the CPU: nothing else runs on this thread while a prompt waits. */
const pauseBriefly = (): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RETRY_PAUSE_MILLISECONDS);
};

const isWouldBlock = (opts: { error: unknown }): boolean =>
  opts.error instanceof Error && 'code' in opts.error && opts.error.code === 'EAGAIN';

/**
 * One line from a file descriptor, read byte by byte so nothing past the newline is consumed.
 * Not Bun's prompt(): it returns null for an empty line, which is not end of input. An empty line
 * is '' here; null is only end of input (Ctrl-D, closed stdin) with nothing read. `read` and `pause`
 * are replaceable so a test can drive the non-blocking retry without a real pipe.
 */
export const readLine = (opts: {
  descriptor: number;
  read?: TByteReader;
  pause?: () => void;
}): string | null => {
  const { descriptor, read = readFromDescriptor, pause = pauseBriefly } = opts;
  const buffer = Buffer.alloc(1);
  const bytes: number[] = [];

  for (;;) {
    let count = 0;

    try {
      count = read({ descriptor, buffer });
    } catch (error) {
      // A non-blocking pipe with nothing buffered yet: wait for the writer instead of failing.
      if (isWouldBlock({ error })) {
        pause();
        continue;
      }

      throw error;
    }

    if (count === 0) {
      return bytes.length === 0 ? null : Buffer.from(bytes).toString('utf8');
    }

    const value = buffer.readUInt8(0);

    if (value === NEWLINE) {
      break;
    }

    bytes.push(value);
  }

  if (bytes.at(-1) === CARRIAGE_RETURN) {
    bytes.pop();
  }

  return Buffer.from(bytes).toString('utf8');
};

/** The shown default is the user's own earlier choice, never one VULCAN made up. */
export const askWithPrompt = (opts: IAskOptions): string | null => {
  process.stdout.write(
    opts.previous === undefined
      ? `? ${opts.question} > `
      : `? ${opts.question} (${opts.previous}) > `,
  );

  return readLine({ descriptor: CreateConstants.STDIN_DESCRIPTOR });
};

const NEW_FOLDER = ':new-folder';

/** A menu, not a line: existing folders are picked, a new name is typed with its default shown. */
const askWithMenus: TAsk = async opts => {
  if (opts.choices !== undefined && opts.choices.length > 0) {
    const picked = await promptSelect({
      message: opts.question,
      choices: [
        ...opts.choices.map(value => ({ value, label: value })),
        { value: NEW_FOLDER, label: 'New folder...' },
      ],
      initial: opts.previous,
    });

    if (picked !== NEW_FOLDER) {
      return picked;
    }
  }

  return promptText({
    message: opts.question,
    defaultValue: opts.previous,
    validate: opts.validate,
  });
};

/** Menus in a terminal that can draw them, the plain question everywhere else. */
export const askInTerminal: TAsk = opts =>
  menusAvailable() ? askWithMenus(opts) : askWithPrompt(opts);

const askUntilValid = async (opts: { field: INameField; ask: TAsk }): Promise<string | null> => {
  const { field } = opts;
  const validate = (value: string): string | undefined => {
    const name = value.trim() === '' ? (field.previous ?? '') : value.trim();

    if (name === '' && field.optional === true) {
      return undefined;
    }

    return nameProblem({ name });
  };

  for (;;) {
    const answer = await opts.ask({
      question: field.question,
      previous: field.previous,
      choices: field.choices,
      validate,
    });

    if (answer === null) {
      return null;
    }

    const name = answer.trim() === '' ? (opts.field.previous ?? '') : answer.trim();

    if (name === '' && opts.field.optional === true) {
      return '';
    }

    if (isValidName({ name })) {
      return name;
    }

    process.stderr.write(
      `  '${name}' is not a name: lowercase letters, digits and '-', starting with a letter or digit\n`,
    );
  }
};

/** Every name from its flag; a missing one is asked in a TTY and an error otherwise. */
export const resolveNames = async (opts: {
  fields: INameField[];
  args: string[];
  interactive: boolean;
  ask: TAsk;
}): Promise<TNamesResult> => {
  const names: Record<string, string> = {};

  for (const field of opts.fields) {
    const flagged = readFlag({ args: opts.args, flag: field.flag });

    if (flagged !== undefined) {
      if (!isValidName({ name: flagged })) {
        return {
          ok: false,
          error: `${field.flag} '${flagged}' is not a name: lowercase letters, digits and '-'`,
        };
      }

      names[field.key] = flagged;
      continue;
    }

    if (!opts.interactive) {
      if (field.optional === true) {
        names[field.key] = '';
        continue;
      }

      if (field.previous !== undefined) {
        names[field.key] = field.previous;
        continue;
      }

      return {
        ok: false,
        error: `missing ${field.flag} (${field.question}) - names are never chosen for you`,
      };
    }

    if (field.fixed === true && field.previous !== undefined) {
      names[field.key] = field.previous;
      continue;
    }

    const answer = await askUntilValid({ field, ask: opts.ask });

    if (answer === null) {
      return { ok: false, error: 'aborted' };
    }

    names[field.key] = answer;
  }

  return { ok: true, names };
};

/** Two folders given the same name would mix kinds of code; the error names both flags. */
export const findFolderClash = (opts: {
  folders: { flag: string; value: string }[];
}): string | undefined => {
  for (const [index, first] of opts.folders.entries()) {
    const second = opts.folders.slice(index + 1).find(other => other.value === first.value);

    if (second !== undefined) {
      return `${first.flag} and ${second.flag} both name '${first.value}' - each kind of code needs its own folder`;
    }
  }

  return undefined;
};
