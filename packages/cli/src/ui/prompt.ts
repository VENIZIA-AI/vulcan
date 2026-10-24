import { confirm, isCancel, multiselect, note, select, text } from '@clack/prompts';
import { guardAgainstPipedLines } from './keyboard.ts';

/** One line of a menu: what it is called, and a short note beside it. */
export interface IChoice {
  value: string;
  label: string;
  hint?: string;
}

/**
 * Free text, only where there is nothing to pick from (a new name). A default, when there is one, is
 * shown and taken on Enter; `validate` returns the message to show, or nothing when the text is fine.
 * Every prompt answers `null` when the user cancelled (Esc, Ctrl-C): the command stops, never picks
 * for them.
 */
export const promptText = async (opts: {
  message: string;
  defaultValue?: string;
  validate?: (value: string) => string | undefined;
}): Promise<string | null> => {
  const value = await guardAgainstPipedLines(() =>
    text({
      message: opts.message,
      ...(opts.defaultValue === undefined
        ? {}
        : { placeholder: opts.defaultValue, defaultValue: opts.defaultValue }),
      validate: (input) => opts.validate?.(input ?? ''),
    }),
  );

  return isCancel(value) ? null : value;
};

/** Pick one: arrows to move, Enter to choose. */
export const promptSelect = async (opts: {
  message: string;
  choices: IChoice[];
  initial?: string;
}): Promise<string | null> => {
  const value = await guardAgainstPipedLines(() =>
    select({
      message: opts.message,
      options: opts.choices.map((choice) => ({
        value: choice.value,
        label: choice.label,
        ...(choice.hint === undefined ? {} : { hint: choice.hint }),
      })),
      initialValue: opts.initial,
    }),
  );

  return isCancel(value) ? null : value;
};

/** Tick any number: arrows to move, space to toggle, `a` for all, Enter to confirm; what is ticked at the start is `initial`. */
export const promptMultiselect = async (opts: {
  message: string;
  choices: IChoice[];
  initial: string[];
}): Promise<string[] | null> => {
  const value = await guardAgainstPipedLines(() =>
    multiselect({
      message: opts.message,
      options: opts.choices.map((choice) => ({
        value: choice.value,
        label: choice.label,
        ...(choice.hint === undefined ? {} : { hint: choice.hint }),
      })),
      initialValues: opts.initial,
      required: false,
    }),
  );

  return isCancel(value) ? null : value;
};

export const promptConfirm = async (opts: {
  message: string;
  initial?: boolean;
}): Promise<boolean | null> => {
  const value = await guardAgainstPipedLines(() =>
    confirm({ message: opts.message, initialValue: opts.initial ?? true }),
  );

  return isCancel(value) ? null : value;
};

/** The summary of what is about to be written, then the confirm; true only when the user said yes. */
export const promptPlan = async (opts: { title: string; lines: string[] }): Promise<boolean> => {
  note(opts.lines.join('\n'), opts.title);

  return (await promptConfirm({ message: 'Write these files?' })) === true;
};
