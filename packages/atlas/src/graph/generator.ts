import { ProjectConfig } from '@/common/project-config';
import { CodeGraph } from './code-graph';
import { GraphFiles, GraphNodeKinds } from './common/constants';
import { GraphSymbols } from './graph-symbols';

const USAGE = 'usage: vulcan x atlas graph build';

export const runGraphCommand = (opts: { command?: string; args?: string[] }): number => {
  if (opts.command !== 'build' || (opts.args ?? []).length > 0) {
    console.error(USAGE);

    return 2;
  }

  try {
    const project = ProjectConfig.readAtlasProject();
    const { records, error } = GraphSymbols.recordsOf({ project });
    const graph = CodeGraph.build({ root: project.root, project, records });

    if (graph === undefined) {
      console.error(
        'vulcan x atlas graph: git cannot list the tracked files (not a repository, git missing, a timeout, or too many files)',
      );

      return 1;
    }

    CodeGraph.write({ root: project.root, graph });

    if (error !== undefined) {
      console.error(`vulcan x atlas graph: no symbols in the graph, the reader failed: ${error}`);
    }

    const files = graph.nodes.filter((node) => node.kind === GraphNodeKinds.FILE).length;
    const symbols = graph.nodes.filter((node) => node.kind === GraphNodeKinds.SYMBOL).length;

    console.log(
      `graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${files} files, ${symbols} symbols, commit ${graph.source.commit ?? 'none'} -> ${GraphFiles.DIRECTORY}/${GraphFiles.CODE}`,
    );

    return 0;
  } catch (error) {
    console.error(
      `vulcan x atlas graph: ${error instanceof Error ? error.message : String(error)}`,
    );

    return 1;
  }
};
