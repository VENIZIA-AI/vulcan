import { ProjectConfig } from '@/common/project-config';
import { CodeGraph } from './code-graph';
import { GraphFiles } from './common/constants';

const USAGE = 'usage: vulcan x atlas graph build';

export const runGraphCommand = (opts: { command?: string; args?: string[] }): number => {
  if (opts.command !== 'build' || (opts.args ?? []).length > 0) {
    console.error(USAGE);

    return 2;
  }

  const project = ProjectConfig.readAtlasProject();
  const graph = CodeGraph.build({ root: project.root, project });

  if (graph === undefined) {
    console.error(
      'vulcan x atlas graph: git cannot list the tracked files - run it in a repository',
    );

    return 1;
  }

  CodeGraph.write({ root: project.root, graph });

  const files = graph.nodes.filter((node) => node.kind === 'file').length;

  console.log(
    `graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${files} files, commit ${graph.source.commit ?? 'none'} -> ${GraphFiles.DIRECTORY}/${GraphFiles.CODE}`,
  );

  return 0;
};
