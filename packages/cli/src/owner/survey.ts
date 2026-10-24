import { OwnerConstants, OwnerDetails, OwnerFormalities, OwnerTones } from './constants.ts';
import { OWNER_LABEL_SET, PROFILE_SCHEMA } from './schema.ts';
import type { TOwnerLabelSet, TProfile } from './schema.ts';

export interface ISurveyChoice {
  value: string;
  label: string;
}

/**
 * How the form asks: menus in a terminal, plain lines elsewhere. `null` is a cancel or the end of the
 * input, and stops the survey with nothing written.
 */
export interface ISurveyIo {
  text: (opts: {
    message: string;
    defaultValue: string;
    validate?: (value: string) => string | undefined;
  }) => Promise<string | null>;
  select: (opts: {
    message: string;
    choices: ISurveyChoice[];
    initial: string;
  }) => Promise<string | null>;
  confirm: (opts: { message: string; initial: boolean }) => Promise<boolean | null>;
}

/** The language of the machine as a code (`vi` from `vi_VN.UTF-8`), or English. */
export const systemLanguageOf = (opts: { env: Record<string, string | undefined> }): string => {
  const raw = opts.env.LC_ALL ?? opts.env.LC_MESSAGES ?? opts.env.LANG ?? '';
  const code = /^([a-z]{2,3})(?:[_.@-]|$)/.exec(raw)?.[1];

  return code ?? OwnerConstants.DEFAULT_LANGUAGE;
};

const labelProblem = (value: string): string | undefined =>
  OwnerConstants.LABEL_PATTERN.test(value)
    ? undefined
    : 'one line of at most 80 characters, with no backtick, pipe or quote';

const optionalLabelProblem = (value: string): string | undefined =>
  value === '' ? undefined : labelProblem(value);

const aboutProblem = (value: string): string | undefined =>
  value.length > 2000 ? 'at most 2000 characters' : undefined;

const codeTasteProblem = (value: string): string | undefined =>
  value.length > 1000 ? 'at most 1000 characters' : undefined;

/** A single dash clears an optional value that an earlier run set: an empty answer keeps it. */
export const CLEAR_ANSWER = '-';

const languageProblem = (value: string): string | undefined =>
  OwnerConstants.LANGUAGE_PATTERN.test(value) ? undefined : 'a language code such as en or pt-BR';

const choicesOf = (opts: { set: Set<string> }): ISurveyChoice[] =>
  [...opts.set].map((value) => ({ value, label: value }));

/** The label set typed word by word, each default the English one; `null` when the user cancelled. */
const askLabels = async (opts: { io: ISurveyIo }): Promise<TOwnerLabelSet | null> => {
  const english = OwnerConstants.DEFAULT_LABELS;
  const ask = (
    message: string,
    defaultValue: string,
    extra?: (value: string) => string | undefined,
  ) =>
    opts.io.text({
      message,
      defaultValue,
      validate: (value) => labelProblem(value) ?? extra?.(value),
    });
  const columns: string[] = [];

  for (const [index, name] of [
    'the number column',
    'the task column',
    'the status column',
  ].entries()) {
    const answer = await ask(`Header of ${name}`, english.minimapColumns[index]);

    if (answer === null) {
      return null;
    }

    columns.push(answer === '' ? english.minimapColumns[index] : answer);
  }

  const status: Record<string, string> = {};

  for (const [key, value] of Object.entries(english.status)) {
    const answer = await ask(`Word for the status "${value}"`, value);

    if (answer === null) {
      return null;
    }

    status[key] = answer === '' ? value : answer;
  }

  const labels: Record<string, string> = {};

  for (const [key, value] of Object.entries(english.labels)) {
    const extra =
      key === 'recommend'
        ? (text: string) =>
            text.includes('{x}') ? undefined : 'must contain {x}, where the answer goes'
        : undefined;
    const answer = await ask(`Label "${value}"`, value, extra);

    if (answer === null) {
      return null;
    }

    labels[key] = answer === '' ? value : answer;
  }

  return OWNER_LABEL_SET.parse({
    minimapColumns: columns,
    status,
    labels,
  });
};

/**
 * The questions, in order, each with a default taken on an empty answer and each skippable: the
 * reply language, how to address the person, tone, report detail, working habits, a free line in their
 * words and code taste, and - for a language that is not English - the words for the report. Nothing is
 * inferred from the answers. `existing` supplies the defaults when the form is run again. Returns the
 * profile, or `null` when the user cancelled.
 */
export const runSurvey = async (opts: {
  io: ISurveyIo;
  existing?: TProfile;
  systemLanguage: string;
}): Promise<TProfile | null> => {
  const { io, existing } = opts;
  const text = async (
    message: string,
    defaultValue: string,
    validate?: (value: string) => string | undefined,
  ) => io.text({ message, defaultValue, validate });
  /** An optional free value: a single dash clears what an earlier run set. */
  const optional = async (
    message: string,
    defaultValue: string,
    validate?: (value: string) => string | undefined,
  ) => {
    const answer = await io.text({
      message: defaultValue === '' ? message : `${message} (${CLEAR_ANSWER} clears it)`,
      defaultValue,
      validate: (value) => (value === CLEAR_ANSWER ? undefined : validate?.(value)),
    });

    return answer === CLEAR_ANSWER ? '' : answer;
  };
  const language = await text(
    'Reply language (a code such as en, fr, pt-BR)',
    existing?.language ?? opts.systemLanguage,
    languageProblem,
  );

  if (language === null) {
    return null;
  }

  const you = await optional(
    'How should I address you? (a name, a pronoun, an honorific, or leave empty for none)',
    existing?.address.you ?? '',
    optionalLabelProblem,
  );
  const self =
    you === null
      ? null
      : await optional(
          'How should I refer to myself? (leave empty for neutral)',
          existing?.address.self ?? '',
          optionalLabelProblem,
        );
  const formality =
    self === null
      ? null
      : await io.select({
          message: 'How formal should I be?',
          choices: choicesOf({ set: OwnerFormalities.SCHEME_SET }),
          initial: existing?.address.formality ?? OwnerFormalities.NEUTRAL,
        });
  const tone =
    formality === null
      ? null
      : await io.select({
          message: 'Tone',
          choices: choicesOf({ set: OwnerTones.SCHEME_SET }),
          initial: existing?.tone ?? OwnerTones.NEUTRAL,
        });
  const reportDetail =
    tone === null
      ? null
      : await io.select({
          message: 'Reports: headline only, or headline plus tables?',
          choices: choicesOf({ set: OwnerDetails.SCHEME_SET }),
          initial: existing?.reportDetail ?? OwnerDetails.TABLES,
        });
  const ask =
    reportDetail === null
      ? null
      : await io.confirm({
          message:
            'For a choice that can be undone, ask you first? (no: state a default and continue)',
          initial: existing?.habits.askBeforeReversible ?? false,
        });
  const commits =
    ask === null
      ? null
      : await io.confirm({
          message: 'Propose commits when a piece of work is done?',
          initial: existing?.habits.proposeCommits ?? false,
        });
  const about =
    commits === null
      ? null
      : await optional(
          'Anything about how you like to work, or to be worked with? (your own words, optional)',
          existing?.about ?? '',
          aboutProblem,
        );
  const codeTaste =
    about === null
      ? null
      : await optional(
          'Taste in code that no formatter or lint rule already enforces? (optional)',
          existing?.codeTaste ?? '',
          codeTasteProblem,
        );

  if (
    [you, self, formality, tone, reportDetail, ask, commits, about, codeTaste].some(
      (answer) => answer === null,
    )
  ) {
    return null;
  }

  const labels: Record<string, TOwnerLabelSet> = { ...existing?.labels };

  if (language !== OwnerConstants.DEFAULT_LANGUAGE && !(language in labels)) {
    const typed = await io.select({
      message: `Words for reports in ${language}: only English ships. Type them now, or keep English?`,
      choices: [
        { value: 'keep', label: 'keep English' },
        { value: 'type', label: 'type them now' },
      ],
      initial: 'keep',
    });

    if (typed === null) {
      return null;
    }

    if (typed === 'type') {
      const set = await askLabels({ io });

      if (set === null) {
        return null;
      }

      labels[language] = set;
    }
  }

  return PROFILE_SCHEMA.parse({
    schemaVersion: OwnerConstants.PROFILE_SCHEMA_VERSION,
    language,
    address: {
      ...(you === '' || you === null ? {} : { you }),
      ...(self === '' || self === null ? {} : { self }),
      formality,
    },
    tone,
    reportDetail,
    habits: { askBeforeReversible: ask, proposeCommits: commits },
    ...(about === '' || about === null ? {} : { about }),
    ...(codeTaste === '' || codeTaste === null ? {} : { codeTaste }),
    ...(existing?.enforce === undefined ? {} : { enforce: existing.enforce }),
    ...(existing?.shortReplyWords === undefined
      ? {}
      : { shortReplyWords: existing.shortReplyWords }),
    labels,
  });
};
