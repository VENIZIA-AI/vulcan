import { ProjectKey } from '../events/project-key.ts';
import { CreateFlags } from './common/index.ts';
import { ProjectNames } from './names.ts';

type TKeyChoice = { ok: true; key: string; note?: string } | { ok: false; error: string };

/** The key a new project's flows are named by: `--key`, else a terminal's answer, else one made from the name. */
export class KeyChoice {
  /**
   * `--key` always wins. Otherwise a terminal is asked, with the key made from the project name as the default; with
   * no terminal the key is made from the name and said (`note`), and a name that makes none is an error.
   */
  static resolve(opts: { args: string[]; name: string; interactive: boolean }): TKeyChoice {
    const flagged = ProjectNames.readFlag({ args: opts.args, flag: CreateFlags.KEY });

    if (flagged !== undefined) {
      return ProjectKey.parse({ value: flagged }) === undefined
        ? {
            ok: false,
            error: `${CreateFlags.KEY} '${flagged}' is not a key: ${ProjectKey.MESSAGE}`,
          }
        : { ok: true, key: flagged };
    }

    const derived = ProjectKey.derive({ name: opts.name });

    if (!opts.interactive) {
      return derived === undefined
        ? {
            ok: false,
            error: `no key can be made from '${opts.name}': pass ${CreateFlags.KEY} <KEY> (${ProjectKey.MESSAGE})`,
          }
        : {
            ok: true,
            key: derived,
            note: `project key ${derived}, made from the name: flows will be VULZ-${derived}-<number>; to use another, change project.key in the config`,
          };
    }

    for (;;) {
      const answer = ProjectNames.askWithPrompt({
        question: `Project key for flow ids, as VULZ-<key>-<number> (${ProjectKey.MESSAGE})`,
        ...(derived === undefined ? {} : { previous: derived }),
      });

      if (answer === null) {
        return { ok: false, error: 'aborted' };
      }

      const value =
        answer.trim() === '' ? derived : ProjectKey.parse({ value: answer.trim().toUpperCase() });

      if (value !== undefined) {
        return { ok: true, key: value };
      }

      process.stderr.write(`  not a key: ${ProjectKey.MESSAGE}\n`);
    }
  }
}
