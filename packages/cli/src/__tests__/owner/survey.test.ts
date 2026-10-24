import { describe, expect, test } from 'bun:test';
import { PROFILE_SCHEMA, runSurvey, systemLanguageOf } from '../../owner/index.ts';
import type { ISurveyIo } from '../../owner/index.ts';

/** A form io fed from a queue of answers; `undefined` takes the default, `null` cancels. */
const ioWith = (
  answers: (string | boolean | null | undefined)[],
): { io: ISurveyIo; asked: string[] } => {
  const queue = [...answers];
  const asked: string[] = [];

  return {
    asked,
    io: {
      text: async (opts) => {
        asked.push(opts.message);

        const answer = queue.shift();

        if (answer === null) {
          return null;
        }

        const value = answer === undefined ? opts.defaultValue : String(answer);
        const problem = opts.validate?.(value);

        if (problem !== undefined) {
          throw new Error(`invalid test answer ${JSON.stringify(value)}: ${problem}`);
        }

        return value;
      },
      select: async (opts) => {
        asked.push(opts.message);

        const answer = queue.shift();

        return answer === null ? null : answer === undefined ? opts.initial : String(answer);
      },
      confirm: async (opts) => {
        asked.push(opts.message);

        const answer = queue.shift();

        return answer === null ? null : answer === undefined ? opts.initial : Boolean(answer);
      },
    },
  };
};

describe('systemLanguageOf', () => {
  test.each([
    [{ LANG: 'fr_FR.UTF-8' }, 'fr'],
    [{ LC_ALL: 'pt_BR.UTF-8', LANG: 'en_US.UTF-8' }, 'pt'],
    [{ LANG: 'C' }, 'en'],
    [{ LANG: 'POSIX' }, 'en'],
    [{}, 'en'],
    [{ LANG: 'de' }, 'de'],
  ])('%j gives %s', (env, expected) => {
    expect(systemLanguageOf({ env })).toBe(expected);
  });
});

describe('runSurvey', () => {
  test('every answer skipped gives the neutral profile in the machine language', async () => {
    const { io } = ioWith([]);
    const profile = await runSurvey({ io, systemLanguage: 'en' });

    expect(profile).toEqual(
      PROFILE_SCHEMA.parse({
        schemaVersion: 1,
        language: 'en',
        address: { formality: 'neutral' },
        tone: 'neutral',
        reportDetail: 'tables',
        habits: { askBeforeReversible: false, proposeCommits: false },
        labels: {},
      }),
    );
  });

  test('the answers become the profile, free text kept as typed, nothing inferred', async () => {
    const { io } = ioWith([
      'en',
      'Sam',
      'I',
      'informal',
      'friendly',
      'headline',
      true,
      true,
      'Short answers, please.',
      'Early returns.',
    ]);
    const profile = await runSurvey({ io, systemLanguage: 'en' });

    expect(profile?.address).toEqual({ you: 'Sam', self: 'I', formality: 'informal' });
    expect(profile?.tone).toBe('friendly');
    expect(profile?.reportDetail).toBe('headline');
    expect(profile?.habits).toEqual({ askBeforeReversible: true, proposeCommits: true });
    expect(profile?.about).toBe('Short answers, please.');
    expect(profile?.codeTaste).toBe('Early returns.');
  });

  test('a language other than English offers the words for reports, and typed words are stored for it', async () => {
    const english = ['Task', 'Status'];

    expect(english).toHaveLength(2);

    const { io, asked } = ioWith([
      'fr',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'type',
      'n',
      'Tache',
      'Etat',
      'fait',
      'en cours',
      'en attente',
      'a faire',
      'bloque',
      'abandonne',
      'Bloque :',
      'Decisions a prendre',
      'aucun',
      'Rien a decider.',
      'Je recommande **{x}**.',
    ]);
    const profile = await runSurvey({ io, systemLanguage: 'en' });

    expect(asked.some((message) => message.includes('only English ships'))).toBe(true);
    expect(profile?.language).toBe('fr');
    expect(profile?.labels.fr?.status.done).toBe('fait');
    expect(profile?.labels.fr?.labels.recommend).toBe('Je recommande **{x}**.');
    expect(profile?.labels.fr?.minimapColumns).toEqual(['n', 'Tache', 'Etat']);
  });

  test('keeping English stores no label set; a set already stored is not asked for again', async () => {
    const keep = await runSurvey({
      io: ioWith(['fr', ...Array.from({ length: 9 }, () => undefined)]).io,
      systemLanguage: 'en',
    });

    expect(keep?.labels).toEqual({});

    const existing = PROFILE_SCHEMA.parse({
      schemaVersion: 1,
      language: 'fr',
      labels: {
        fr: {
          minimapColumns: ['n', 't', 'e'],
          status: { done: 'a', doing: 'b', waiting: 'c', todo: 'd', blocked: 'e', dropped: 'f' },
          labels: {
            blocked: 'x',
            decisions: 'y',
            noBlocker: 'z',
            noDecision: 'w',
            recommend: 'v {x}',
          },
        },
      },
    });
    const { io, asked } = ioWith([]);
    const again = await runSurvey({ io, existing, systemLanguage: 'en' });

    expect(again?.labels.fr?.labels.blocked).toBe('x');
    expect(asked.some((message) => message.includes('only English ships'))).toBe(false);
  });

  test('run again, the earlier answers are the defaults and the stricter enforce is kept', async () => {
    const existing = PROFILE_SCHEMA.parse({
      schemaVersion: 1,
      language: 'en',
      address: { you: 'Alex', formality: 'formal' },
      tone: 'terse',
      about: 'Be brief.',
      enforce: 'block',
    });
    const again = await runSurvey({ io: ioWith([]).io, existing, systemLanguage: 'fr' });

    expect(again?.address.you).toBe('Alex');
    expect(again?.address.formality).toBe('formal');
    expect(again?.tone).toBe('terse');
    expect(again?.about).toBe('Be brief.');
    expect(again?.enforce).toBe('block');
    expect(again?.language).toBe('en');
  });

  test.each([0, 1, 3, 6, 9])('a cancel at question %d gives nothing', async (position) => {
    const answers: (string | null | undefined)[] = Array.from({ length: 10 }, () => undefined);

    answers[position] = null;

    expect(await runSurvey({ io: ioWith(answers).io, systemLanguage: 'en' })).toBeNull();
  });
});
