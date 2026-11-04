import { EventConstants, EventSecrets } from './common/index.ts';
import type { IEventItem } from './common/index.ts';

/** The words that go into a log line: one line, no secret-shaped token, a fixed length. */
export class EventText {
  /** `text` with every secret-shaped token replaced. Best effort: the writer keeps secrets out of its summary. */
  static redact(opts: { text: string }): string {
    let text = opts.text;

    for (const pattern of EventSecrets.PATTERNS) {
      text = text.replace(pattern, EventConstants.REDACTED);
    }

    return text
      .replace(EventSecrets.URL_USERINFO, `$1${EventConstants.REDACTED}@`)
      .replace(EventSecrets.ASSIGNMENT, `$1=${EventConstants.REDACTED}`)
      .replace(EventSecrets.SPOKEN, `$1 is ${EventConstants.REDACTED}`);
  }

  /** `text` with each run of control characters (C0, DEL and C1) replaced by one space: what a reader prints is never an escape sequence. */
  static stripControl(opts: { text: string }): string {
    let stripped = '';
    let inRun = false;

    for (const character of opts.text) {
      const code = character.codePointAt(0) ?? 0;
      const isControl = code <= 0x1f || (code >= 0x7f && code <= 0x9f);

      if (!isControl) {
        stripped += character;
      } else if (!inRun) {
        stripped += ' ';
      }

      inRun = isControl;
    }

    return stripped;
  }

  /** The items as they are kept: each text one line of at most `max` characters, none empty, at most `count`. */
  static items(opts: { items: IEventItem[]; max: number; count: number }): IEventItem[] {
    return opts.items
      .map((item) => ({
        text: EventText.oneLine({ text: item.text, max: opts.max }),
        done: item.done,
      }))
      .filter((item) => item.text !== '')
      .slice(0, opts.count);
  }

  /** One line of at most `max` characters: control characters and runs of space become one space, secrets are redacted first. */
  static oneLine(opts: { text: string; max: number }): string {
    const flat = EventText.stripControl({ text: opts.text }).replace(/\s+/g, ' ').trim();

    return Array.from(EventText.redact({ text: flat }))
      .slice(0, opts.max)
      .join('')
      .trim();
  }
}
