import { readSync } from 'node:fs';

import { AppSides, CreateConstants, CreateFlags } from './common/index.ts';
import type { INameField, TAppSide, TAsk, TNamesResult } from './common/index.ts';

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

const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;

/**
 * One line from a file descriptor, read byte by byte so nothing past the newline is consumed.
 * Not Bun's prompt(): it returns null for an empty line, which is not end of input. An empty line
 * is '' here; null is only end of input (Ctrl-D, closed stdin) with nothing read.
 */
export const readLine = (opts: { descriptor: number }): string | null => {
  const byte = Buffer.alloc(1);
  const bytes: number[] = [];

  for (;;) {
    let count = 0;

    try {
      count = readSync(opts.descriptor, byte, 0, 1, null);
    } catch (error) {
      // A non-blocking pipe with nothing buffered yet: wait for the writer instead of failing.
      if ((error as NodeJS.ErrnoException).code === 'EAGAIN') {
        continue;
      }

      throw error;
    }

    if (count === 0) {
      return bytes.length === 0 ? null : Buffer.from(bytes).toString('utf8');
    }

    if (byte[0] === NEWLINE) {
      break;
    }

    bytes.push(byte[0]!);
  }

  if (bytes.at(-1) === CARRIAGE_RETURN) {
    bytes.pop();
  }

  return Buffer.from(bytes).toString('utf8');
};

/** The shown default is the user's own earlier choice, never one VULCAN made up. */
export const askWithPrompt: TAsk = opts => {
  process.stdout.write(
    opts.previous === undefined
      ? `? ${opts.question} > `
      : `? ${opts.question} (${opts.previous}) > `,
  );

  return readLine({ descriptor: CreateConstants.STDIN_DESCRIPTOR });
};

const askUntilValid = (opts: { field: INameField; ask: TAsk }): string | null => {
  for (;;) {
    const answer = opts.ask({ question: opts.field.question, previous: opts.field.previous });

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
export const resolveNames = (opts: {
  fields: INameField[];
  args: string[];
  interactive: boolean;
  ask: TAsk;
}): TNamesResult => {
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

    const answer = askUntilValid({ field, ask: opts.ask });

    if (answer === null) {
      return { ok: false, error: 'aborted' };
    }

    names[field.key] = answer;
  }

  return { ok: true, names };
};
