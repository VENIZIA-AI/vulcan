import { confirm, isCancel, multiselect, note, select, text } from '@clack/prompts';
import { MenuInput } from './keyboard.ts';

/** One line of a menu: what it is called, and a short note beside it. */
interface IChoice {
  value: string;
  label: string;
  hint?: string;
}

export class TerminalPrompt {
  /**
   * Free text, only where there is nothing to pick from (a new name). A default, when there is one, is
   * shown and taken on Enter; `validate` returns the message to show, or nothing when the text is fine.
   * Every prompt answers `null` when the user cancelled (Esc, Ctrl-C): the command stops, never picks
   * for them.
   */
  static async promptText(opts: {
    message: string;
    defaultValue?: string;
    validate?: (value: string) => string | undefined;
  }): Promise<string | null> {
    const value = await MenuInput.guardAgainstPipedLines(() =>
      text({
        message: opts.message,
        ...(opts.defaultValue === undefined
          ? {}
          : { placeholder: opts.defaultValue, defaultValue: opts.defaultValue }),
        validate: (input) => opts.validate?.(input ?? ''),
      }),
    );

    return isCancel(value) ? null : value;
  }

  /** Pick one: arrows to move, Enter to choose. */
  static async promptSelect(opts: {
    message: string;
    choices: IChoice[];
    initial?: string;
  }): Promise<string | null> {
    const value = await MenuInput.guardAgainstPipedLines(() =>
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
  }

  /** Tick any number: arrows to move, space to toggle, `a` for all, Enter to confirm; what is ticked at the start is `initial`. */
  static async promptMultiselect(opts: {
    message: string;
    choices: IChoice[];
    initial: string[];
  }): Promise<string[] | null> {
    const value = await MenuInput.guardAgainstPipedLines(() =>
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
  }

  static async promptConfirm(opts: {
    message: string;
    initial?: boolean;
  }): Promise<boolean | null> {
    const value = await MenuInput.guardAgainstPipedLines(() =>
      confirm({ message: opts.message, initialValue: opts.initial ?? true }),
    );

    return isCancel(value) ? null : value;
  }

  /** The summary of what is about to be written, then the confirm; true only when the user said yes. */
  static async promptPlan(opts: { title: string; lines: string[] }): Promise<boolean> {
    note(opts.lines.join('\n'), opts.title);

    const confirmed = await TerminalPrompt.promptConfirm({ message: 'Write these files?' });

    return confirmed === true;
  }
}
