import { readAtlasProject } from '@/common/project-config';
import type { TConstValue } from '@/common/types';
import { checkConcepts } from './check';
import { ConceptProblems } from './common';
import type { IConceptProblem } from './common';
import { stampConcepts } from './stamp';

const USAGE = 'usage: vulcan x atlas concepts stamp|check';
const STAMP_HINT = 'review the concept, then `vulcan x atlas concepts stamp`';

const MESSAGE_BY_PROBLEM: Record<TConstValue<typeof ConceptProblems>, string> = {
  [ConceptProblems.MISSING]: 'the built packages do not export it (build first)',
  [ConceptProblems.CHANGED]: 'its signature changed',
  [ConceptProblems.UNSTAMPED]: 'the lock does not carry it',
  [ConceptProblems.MALFORMED]: 'not `<npm name>#<Symbol>` of a declared package',
};

const printProblems = (opts: { problems: IConceptProblem[]; hint: string }): void => {
  for (const entry of opts.problems) {
    console.log(
      `concepts: ${entry.concept} names ${entry.symbol} - ${MESSAGE_BY_PROBLEM[entry.problem]}; ${opts.hint}`,
    );
  }
};

/** `vulcan x atlas concepts stamp|check` - V4; check needs a build, so it runs where `surface check` does. */
export const runConceptsCommand = (opts: { command?: string }): number => {
  switch (opts.command) {
    case 'stamp': {
      const report = stampConcepts({ project: readAtlasProject() });

      if (report.missing.length > 0) {
        printProblems({ problems: report.missing, hint: 'fix the concept, then stamp again' });
        console.log(`concepts: ${report.missing.length} to fix, nothing stamped`);

        return 1;
      }

      console.log(`concepts: stamped ${report.stamped} symbols into ${report.lockFile}`);

      return 0;
    }
    case 'check': {
      const report = checkConcepts({ project: readAtlasProject() });

      printProblems({ problems: report.problems, hint: STAMP_HINT });
      console.log(
        `concepts: ${report.checked} symbols checked, ${report.problems.length} to review`,
      );

      return report.problems.length === 0 ? 0 : 1;
    }
    default: {
      console.error(USAGE);

      return 2;
    }
  }
};
