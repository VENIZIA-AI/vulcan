import { EventConstants, EventSecrets } from './common/index.ts';
import type { IEventItem } from './common/index.ts';

/** The words that go into a log line: one line, no secret-shaped token, a fixed length. */
export class EventText {
  /** `text` with every secret-shaped token replaced. Best effort: the writer keeps secrets out of its summary. */
  static redact(opts: { text: string }): string {
    let text = opts.text;

    for (const pattern of EventSecrets.PATTERNS) {
      // Group 1, when the pattern has one, is kept; without it the second argument is the offset, a number.
      text = text.replace(pattern, (_match: string, kept: unknown) =>
        typeof kept === 'string' ? `${kept}${EventConstants.REDACTED}` : EventConstants.REDACTED,
      );
    }

    return text
      .replace(EventSecrets.ASSIGNMENT, `$1=${EventConstants.REDACTED}`)
      .replace(EventSecrets.SPOKEN, `$1 is ${EventConstants.REDACTED}`);
  }

  /**
   * The first `max` characters of `text`, redacted. Only the start of a long text is read, enough of it that a secret
   * across the cut at `max` is whole when it is redacted; the word the read cuts through is dropped, not read in half.
   * When the read holds no space and the redaction shrank it into view, the result ends at its last redaction instead.
   */
  static redactHead(opts: { text: string; max: number }): string {
    const length = Math.max(
      opts.max * EventConstants.REDACT_SCAN.factor,
      EventConstants.REDACT_SCAN.min,
    );
    let head = opts.text;
    let isEdgeCut = false;

    if (head.length > length) {
      head = head.slice(0, length).replace(/[\uD800-\uDBFF]$/, '');

      const lastSpace = head.lastIndexOf(' ');

      if (lastSpace > 0) {
        head = head.slice(0, lastSpace);
      } else {
        isEdgeCut = true;
      }
    }

    const redacted = EventText.redact({ text: head });
    const characters = Array.from(redacted);
    const lastRedaction = redacted.lastIndexOf(EventConstants.REDACTED);

    if (isEdgeCut && characters.length <= opts.max && lastRedaction >= 0) {
      return redacted.slice(0, lastRedaction + EventConstants.REDACTED.length);
    }

    return characters.slice(0, opts.max).join('');
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

  /** `2026-11-08`, and a day that exists: `2026-02-30` is not one. The one check of a due day, for the writer and the reader. */
  static isDay(opts: { value: string }): boolean {
    const time = Date.parse(`${opts.value}T00:00:00Z`);

    return (
      EventConstants.DUE_PATTERN.test(opts.value) &&
      Number.isFinite(time) &&
      new Date(time).toISOString().startsWith(opts.value)
    );
  }

  /** One line of at most `max` characters: control characters and runs of space become one space, secrets are redacted first. */
  static oneLine(opts: { text: string; max: number }): string {
    const flat = EventText.stripControl({ text: opts.text }).replace(/\s+/g, ' ').trim();

    return EventText.redactHead({ text: flat, max: opts.max }).trim();
  }
}
