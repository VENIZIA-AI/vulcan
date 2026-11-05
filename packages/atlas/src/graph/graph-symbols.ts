import type { IAtlasProject } from '@/common/project-config';
import { StderrLogger } from '@/common/logger';
import type { ISymbolRecord } from '@/symbols/common/types';
import { SymbolCompute } from '@/symbols/compute';

/** The records the graph's symbols come from: the reader of `api` and `symbol`, which compiles the built declarations. */
export class GraphSymbols {
  /**
   * Every exported symbol of the project. A reader that fails (no TypeScript to read with, a declaration the compiler
   * cannot take) costs the symbols, not the graph: the files and imports are still written, and the reason is said once.
   * `read` is the reader; a test gives its own.
   */
  static recordsOf(opts: {
    project: IAtlasProject;
    read?: (opts: { project: IAtlasProject }) => ISymbolRecord[];
  }): { records: ISymbolRecord[]; error?: string } {
    const read =
      opts.read ??
      ((input: { project: IAtlasProject }) =>
        SymbolCompute.symbolsOfRepository({ project: input.project, withSource: true }));

    try {
      return { records: read({ project: opts.project }) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      StderrLogger.get(GraphSymbols.name)
        .for('recordsOf')
        .warn('symbols left out | error: %s', message);

      return { records: [], error: message };
    }
  }
}
