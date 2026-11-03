import { EventConstants, EventSecrets } from './common/index.ts';

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
      .replace(EventSecrets.ASSIGNMENT, `$1=${EventConstants.REDACTED}`);
  }

  /** One line of at most `max` characters: control characters and runs of space become one space, secrets are redacted first. */
  static oneLine(opts: { text: string; max: number }): string {
    const flat = opts.text
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return Array.from(EventText.redact({ text: flat }))
      .slice(0, opts.max)
      .join('')
      .trim();
  }

  /** The first line of `text` that holds anything, or an empty string. */
  static firstLine(opts: { text: string }): string {
    return opts.text.split(/\r\n|\r|\n/).find((line) => line.trim() !== '') ?? '';
  }
}
