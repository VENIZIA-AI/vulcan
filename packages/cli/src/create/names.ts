import { readSync } from 'node:fs';

import { LayoutFolder } from '../common/layout-folder.ts';
import { TerminalCapability, TerminalPrompt } from '../ui/index.ts';
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
    isPath: true,
  },
  [AppSides.FRONTEND]: {
    key: 'folder',
    flag: CreateFlags.FRONTEND_DIR,
    question: 'Frontend folder (holds every frontend app)',
    isPath: true,
  },
};

/** `@acme`: what `--scope` takes, for a library and for an app. */
export const SCOPE_PATTERN = /^@[a-z0-9][a-z0-9-]*$/;

const isValidName = (opts: { name: string }): boolean =>
  CreateConstants.NAME_PATTERN.test(opts.name);

const NEWLINE = 0x0a;

const CARRIAGE_RETURN = 0x0d;

const RETRY_PAUSE_MILLISECONDS = 5;

const readFromDescriptor: TByteReader = (opts) =>
  readSync(opts.descriptor, opts.buffer, 0, 1, null);

/** A sleep that does not burn the CPU: nothing else runs on this thread while a prompt waits. */
const pauseBriefly = (): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RETRY_PAUSE_MILLISECONDS);
};

const isWouldBlock = (opts: { error: unknown }): boolean =>
  opts.error instanceof Error && 'code' in opts.error && opts.error.code === 'EAGAIN';

export class ProjectNames {
  /** Why a value is not valid for a field: a folder path for a path field, a name for the rest. Undefined when it is valid. */
  private static fieldProblem(opts: { field: INameField; value: string }): string | undefined {
    return opts.field.isPath === true
      ? LayoutFolder.layoutFolderProblem({ folder: opts.value })
      : ProjectNames.nameProblem({ name: opts.value });
  }

  private static async askUntilValid(opts: {
    field: INameField;
    ask: TAsk;
  }): Promise<string | null> {
    const { field } = opts;
    const validate = (value: string): string | undefined => {
      const name = value.trim() === '' ? (field.previous ?? '') : value.trim();

      if (name === '' && field.optional === true) {
        return undefined;
      }

      return ProjectNames.fieldProblem({ field, value: name });
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

      const problem = ProjectNames.fieldProblem({ field, value: name });

      if (problem === undefined) {
        return name;
      }

      process.stderr.write(`  ${problem}\n`);
    }
  }

  /**
   * The optional scope question of a menu: a package scope typed, or nothing for a bare name. Asked only
   * where menus are drawn; a plain terminal and a script give `--scope`. `null` is a cancel.
   */
  static async askScope(): Promise<string | undefined | null> {
    const answer = await TerminalPrompt.promptText({
      message: 'Package scope (optional, like @acme; empty for none)',
      validate: (value) =>
        value.trim() === '' || SCOPE_PATTERN.test(value.trim())
          ? undefined
          : `'${value.trim()}' is not a scope like @acme`,
    });

    return answer === null ? null : answer.trim() === '' ? undefined : answer.trim();
  }

  static readFlag(opts: { args: string[]; flag: string }): string | undefined {
    const index = opts.args.indexOf(opts.flag);

    return index === -1 ? undefined : opts.args[index + 1];
  }

  /** The scope the flag names, validated: none when absent, an error that names the flag when it is not `@scope`. */
  static readScope(opts: {
    args: string[];
  }): { ok: true; scope: string | undefined } | { ok: false; error: string } {
    const given = ProjectNames.readFlag({ args: opts.args, flag: CreateFlags.SCOPE });

    if (given === undefined) {
      return { ok: true, scope: undefined };
    }

    return SCOPE_PATTERN.test(given)
      ? { ok: true, scope: given }
      : { ok: false, error: `${CreateFlags.SCOPE} '${given}' is not a scope like @acme` };
  }

  /** The message a menu shows under a typed name that is not one; nothing when it is fine. */
  static nameProblem(opts: { name: string }): string | undefined {
    return isValidName({ name: opts.name })
      ? undefined
      : `'${opts.name}' is not a name: lowercase letters, digits and '-', starting with a letter or digit`;
  }

  /**
   * One line from a file descriptor, read byte by byte so nothing past the newline is consumed.
   * Not Bun's prompt(): it returns null for an empty line, which is not end of input. An empty line
   * is '' here; null is only end of input (Ctrl-D, closed stdin) with nothing read. `read` and `pause`
   * are replaceable so a test can drive the non-blocking retry without a real pipe.
   */
  static readLine(opts: {
    descriptor: number;
    read?: TByteReader;
    pause?: () => void;
  }): string | null {
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
  }

  /** The shown default is the user's own earlier choice, never one VULCAN made up. */
  static askWithPrompt(opts: IAskOptions): string | null {
    const choices =
      opts.choices !== undefined && opts.choices.length > 1 ? ` [${opts.choices.join(', ')}]` : '';

    process.stdout.write(
      opts.previous === undefined
        ? `? ${opts.question}${choices} > `
        : `? ${opts.question}${choices} (${opts.previous}) > `,
    );

    return ProjectNames.readLine({ descriptor: CreateConstants.STDIN_DESCRIPTOR });
  }

  /** Every name from its flag; a missing one is asked in a TTY and an error otherwise. */
  static async resolve(opts: {
    fields: INameField[];
    args: string[];
    interactive: boolean;
    ask: TAsk;
  }): Promise<TNamesResult> {
    const names: Record<string, string> = {};

    for (const field of opts.fields) {
      const flagged = ProjectNames.readFlag({ args: opts.args, flag: field.flag });

      if (flagged !== undefined) {
        const problem = ProjectNames.fieldProblem({ field, value: flagged });

        if (problem !== undefined) {
          return {
            ok: false,
            error:
              field.isPath === true
                ? `${field.flag} ${problem}`
                : `${field.flag} '${flagged}' is not a name: lowercase letters, digits and '-'`,
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

        const listed =
          field.choices !== undefined && field.choices.length > 1
            ? `; ${LayoutFolder.listedNote({ folders: field.choices })}`
            : '';

        return {
          ok: false,
          error: `missing ${field.flag} (${field.question}${listed}) - names are never chosen for you`,
        };
      }

      if (field.fixed === true && field.previous !== undefined) {
        names[field.key] = field.previous;
        continue;
      }

      const answer = await ProjectNames.askUntilValid({ field, ask: opts.ask });

      if (answer === null) {
        return { ok: false, error: 'aborted' };
      }

      names[field.key] = answer;
    }

    return { ok: true, names };
  }

  /** Two folders given the same name would mix kinds of code; the error names both flags. */
  static findFolderClash(opts: { folders: { flag: string; value: string }[] }): string | undefined {
    for (const [index, first] of opts.folders.entries()) {
      const second = opts.folders.slice(index + 1).find((other) => other.value === first.value);

      if (second !== undefined) {
        return `${first.flag} and ${second.flag} both name '${first.value}' - each kind of code needs its own folder`;
      }
    }

    return undefined;
  }
}

const NEW_FOLDER = ':new-folder';

/** A menu, not a line: existing folders are picked, a new name is typed with its default shown. */
const askWithMenus: TAsk = async (opts) => {
  if (opts.choices !== undefined && opts.choices.length > 0) {
    const picked = await TerminalPrompt.promptSelect({
      message: opts.question,
      choices: [
        ...opts.choices.map((value) => ({ value, label: value })),
        { value: NEW_FOLDER, label: 'New folder...' },
      ],
      initial: opts.previous,
    });

    if (picked !== NEW_FOLDER) {
      return picked;
    }
  }

  return TerminalPrompt.promptText({
    message: opts.question,
    defaultValue: opts.previous,
    validate: opts.validate,
  });
};

/** Menus in a terminal that can draw them, the plain question everywhere else. */
export const askInTerminal: TAsk = (opts) =>
  TerminalCapability.menusAvailable() ? askWithMenus(opts) : ProjectNames.askWithPrompt(opts);
