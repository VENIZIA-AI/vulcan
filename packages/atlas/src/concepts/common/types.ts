import type { TConstValue } from '@/common/types';
import type { ConceptProblems } from './constants';

/** One `symbols:` entry of one concept. */
export interface IDeclaredSymbol {
  /** The concept file, relative to the project root. */
  concept: string;
  /** `<npm name>#<Symbol>`, as the concept wrote it. */
  symbol: string;
}

export interface IConceptProblem extends IDeclaredSymbol {
  problem: TConstValue<typeof ConceptProblems>;
}

export interface IStampReport {
  /** The lock, relative to the project root. */
  lockFile: string;
  stamped: number;
  /** Declarations that resolve to no exported symbol; with any, nothing is written. */
  missing: IConceptProblem[];
}

export interface ICheckReport {
  checked: number;
  problems: IConceptProblem[];
}
