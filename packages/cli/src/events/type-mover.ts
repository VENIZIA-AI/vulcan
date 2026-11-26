import { RecordValue } from '../common/record.ts';
import { EventTypes } from './common/index.ts';

/**
 * The event lines of the releases before 0.5.0 name their type `kind`; an event has `type`. A line with a `kind` that is
 * one of the event types, and no `type`, gets the key renamed in place (its other keys keep their order); every other line
 * is left as it is.
 */
export class EventTypeMover {
  /** The text of a day file with its lines moved to the new key. */
  static moveText(opts: { text: string }): string {
    return opts.text
      .split('\n')
      .map((line) => {
        let parsed: unknown;

        try {
          parsed = JSON.parse(line);
        } catch {
          return line;
        }

        if (!RecordValue.isRecord(parsed) || Object.hasOwn(parsed, 'type')) {
          return line;
        }

        const old = parsed['kind'];

        return typeof old === 'string' && EventTypes.isValid(old)
          ? JSON.stringify(
              Object.fromEntries(
                Object.entries(parsed).map(([key, value]) => [
                  key === 'kind' ? 'type' : key,
                  value,
                ]),
              ),
            )
          : line;
      })
      .join('\n');
  }
}
