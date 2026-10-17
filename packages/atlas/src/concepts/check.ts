import type { IAtlasProject } from '@/common/project-config';
import { symbolsOfRepository } from '@/symbols/compute';
import { ConceptProblems } from './common';
import type { ICheckReport, IConceptProblem } from './common';
import { readDeclaredSymbols, readSymbolsLock, resolveDeclaredSymbol } from './stamp';

/**
 * Project Contract v1, V4: every symbol a concept declares still exists in the built `.d.ts`, with
 * the signature hash the lock holds. A problem sends the concept back for review, then a new stamp.
 */
export const checkConcepts = (opts: { project: IAtlasProject }): ICheckReport => {
  const { project } = opts;
  const declared = readDeclaredSymbols({ project });

  if (declared.length === 0) {
    return { checked: 0, problems: [] };
  }

  const records = symbolsOfRepository({ project });
  const locked = readSymbolsLock({ project })?.symbols ?? {};
  const problems: IConceptProblem[] = [];

  for (const entry of declared) {
    const resolved = resolveDeclaredSymbol({ symbol: entry.symbol, project, records });

    if ('problem' in resolved) {
      problems.push({ ...entry, problem: resolved.problem });
      continue;
    }

    if (locked[entry.symbol] === undefined) {
      problems.push({ ...entry, problem: ConceptProblems.UNSTAMPED });
      continue;
    }

    if (locked[entry.symbol] !== resolved.hash) {
      problems.push({ ...entry, problem: ConceptProblems.CHANGED });
    }
  }

  return { checked: declared.length, problems };
};
