import { CreateConstants } from './common/index.ts';
import type { INameField, TAsk, TNamesResult } from './common/index.ts';

export const readFlag = (opts: { args: string[]; flag: string }): string | undefined => {
  const index = opts.args.indexOf(opts.flag);

  return index === -1 ? undefined : opts.args[index + 1];
};

const isValidName = (opts: { name: string }): boolean =>
  CreateConstants.NAME_PATTERN.test(opts.name);

/** Bun's prompt(); the shown default is the user's own earlier choice, never one VULCAN made up. */
export const askWithPrompt: TAsk = opts =>
  prompt(
    opts.previous === undefined
      ? `? ${opts.question} >`
      : `? ${opts.question} (${opts.previous}) >`,
  );

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
