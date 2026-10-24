import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ExitCodes } from '../common/index.ts';
import type { ICommandContext } from '../common/index.ts';
import { askWithPrompt } from '../create/names.ts';
import {
  OwnerConstants,
  readProfile,
  renderProfile,
  runSurvey,
  systemLanguageOf,
  writeProfile,
} from '../owner/index.ts';
import type { ISurveyIo } from '../owner/index.ts';
import { menusAvailable, promptConfirm, promptSelect, promptText } from '../ui/index.ts';

const YES_FLAG = '--yes';

/** The form in a terminal that can draw menus. */
const menuIo: ISurveyIo = {
  // An empty entry takes the default, so only what was typed is checked.
  text: (opts) =>
    promptText({
      ...opts,
      validate: (value) => (value === '' ? undefined : opts.validate?.(value)),
    }),
  select: (opts) => promptSelect(opts),
  confirm: (opts) => promptConfirm(opts),
};

/** The same questions as plain lines, for a pipe, a log or `TERM=dumb`: an empty line takes the default, the end of the input cancels. */
const lineIo: ISurveyIo = {
  text: async (opts) => {
    const answer = askWithPrompt({
      question: opts.message,
      ...(opts.defaultValue === '' ? {} : { previous: opts.defaultValue }),
    });

    if (answer === null) {
      return null;
    }

    const value = answer.trim() === '' ? opts.defaultValue : answer.trim();
    const problem = opts.validate?.(value);

    if (problem !== undefined) {
      process.stderr.write(`  ${problem}\n`);

      return lineIo.text(opts);
    }

    return value;
  },
  select: async (opts) => {
    const answer = askWithPrompt({
      question: `${opts.message} [${opts.choices.map((choice) => choice.value).join('/')}]`,
      previous: opts.initial,
    });

    if (answer === null) {
      return null;
    }

    const value = answer.trim() === '' ? opts.initial : answer.trim();

    if (opts.choices.some((choice) => choice.value === value)) {
      return value;
    }

    process.stderr.write(`  one of: ${opts.choices.map((choice) => choice.value).join(', ')}\n`);

    return lineIo.select(opts);
  },
  confirm: async (opts) => {
    const answer = askWithPrompt({
      question: `${opts.message} [y/n]`,
      previous: opts.initial ? 'y' : 'n',
    });

    if (answer === null) {
      return null;
    }

    const value = answer.trim().toLowerCase();

    return value === '' ? opts.initial : value.startsWith('y');
  },
};

/** Runs the form and saves the profile; the exit code of the command. */
export const fillInProfile = async (opts: { root: string }): Promise<number> => {
  const current = readProfile({ root: opts.root });

  if (!current.ok) {
    process.stderr.write(
      `vulcan profile: ${current.error} - delete it with 'vulcan profile reset --yes' and run again\n`,
    );

    return ExitCodes.FAILURE;
  }

  const profile = await runSurvey({
    io: menusAvailable() ? menuIo : lineIo,
    existing: current.profile,
    systemLanguage: systemLanguageOf({ env: process.env }),
  });

  if (profile === null) {
    process.stderr.write('vulcan profile: cancelled, nothing written\n');

    return ExitCodes.FAILURE;
  }

  const saved = writeProfile({ root: opts.root, profile });

  if (!saved.ok) {
    process.stderr.write(`vulcan profile: ${saved.error}\n`);

    return ExitCodes.FAILURE;
  }

  process.stderr.write(
    `vulcan profile: saved ${OwnerConstants.PROFILE_FILE} - it stays in this project, gitignored; edit it by hand or run 'vulcan profile' again\n`,
  );

  return ExitCodes.OK;
};

/**
 * After `init`: in a terminal that can draw menus, a project with no profile is offered the form once;
 * anywhere else (a pipe, CI) it only says how to run it. A profile that already exists is left alone.
 */
export const offerProfile = async (opts: { root: string }): Promise<void> => {
  if (existsSync(join(opts.root, OwnerConstants.PROFILE_FILE))) {
    return;
  }

  if (!menusAvailable()) {
    process.stderr.write(
      "tell VULCAN how you like to work (language, how to address you, tone): run 'bun x --no-install vulcan profile'\n",
    );

    return;
  }

  const now = await promptConfirm({
    message:
      "Tell VULCAN how you like to work (language, how to address you, tone)? Every question can be skipped; 'vulcan profile' does it later.",
    initial: true,
  });

  if (now === true) {
    await fillInProfile({ root: opts.root });
  }
};

/**
 * `vulcan profile`: the form (also `edit`), `show` prints the file, `reset` removes it. The file is
 * `.agents/local/profile.json` in this project; nothing is written outside it.
 */
export const runProfileCommand = async (opts: ICommandContext): Promise<number> => {
  const [sub, ...rest] = opts.args.filter((arg) => arg !== YES_FLAG);

  if (sub === undefined || sub === 'edit') {
    return fillInProfile({ root: opts.cwd });
  }

  if (rest.length > 0 || !['show', 'reset'].includes(sub)) {
    process.stderr.write(
      `vulcan profile: unknown argument '${rest[0] ?? sub}' - use show, edit or reset\n`,
    );

    return ExitCodes.FAILURE;
  }

  const file = join(opts.cwd, OwnerConstants.PROFILE_FILE);

  if (sub === 'show') {
    const read = readProfile({ root: opts.cwd });

    if (!read.ok) {
      process.stderr.write(`vulcan profile: ${read.error}\n`);

      return ExitCodes.FAILURE;
    }

    if (read.profile === undefined) {
      process.stderr.write(`vulcan profile: none yet - run 'vulcan profile' to make one\n`);

      return ExitCodes.OK;
    }

    process.stdout.write(renderProfile({ profile: read.profile }));

    return ExitCodes.OK;
  }

  if (!existsSync(file)) {
    process.stderr.write('vulcan profile: nothing to reset\n');

    return ExitCodes.OK;
  }

  if (!opts.args.includes(YES_FLAG)) {
    process.stderr.write(
      `vulcan profile: would delete ${OwnerConstants.PROFILE_FILE} (add --yes)\n`,
    );

    return ExitCodes.OK;
  }

  rmSync(file);
  process.stderr.write(`vulcan profile: deleted ${OwnerConstants.PROFILE_FILE}\n`);

  return ExitCodes.OK;
};
