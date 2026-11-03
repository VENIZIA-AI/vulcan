/** A line git writes between the message and the diff of `git commit -v`; nothing below it is the message. */
const SCISSORS = /^# -+ >8 -+$/;
/** Zero-width and format characters, and the variation selectors that follow an emoji. */
const INVISIBLE = /[\p{Cf}︎️]/gu;
/** Every dash that looks like a hyphen, the non-breaking one included. */
const DASHES = /[\p{Pd}−]/gu;

export class CommitMessage {
  static linesOf(opts: { message: string }): string[] {
    const lines = opts.message.split(/\r\n|\r|\n/);
    const scissors = lines.findIndex((text) => SCISSORS.test(text));

    return scissors === -1 ? lines : lines.slice(0, scissors);
  }

  static cleanOf(opts: { text: string }): string {
    return opts.text.replace(INVISIBLE, '').replace(DASHES, '-');
  }

  /** Letters and digits only, lower case: "Claude Code", "ClaudeCode" and "claude-code" read alike. */
  static compactOf(opts: { text: string }): string {
    return opts.text
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, '');
  }
}
