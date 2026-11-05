import { statSync } from 'node:fs';
import { ProjectConfig } from '@/common/project-config';
import { CodeGraph } from './code-graph';
import { GraphConstants, GraphFiles, GraphNodeKinds } from './common/constants';
import { GraphBuild } from './graph-build';
import { GraphStatus } from './graph-status';
import { join } from 'node:path';

const USAGE = 'usage: vulcan x atlas graph build [--full] | status [--json]';

export const runGraphCommand = (opts: { command?: string; args?: string[] }): number => {
  const args = new Set(opts.args ?? []);
  const isBuild = opts.command === 'build' && [...args].every((arg) => arg === '--full');
  const isStatus = opts.command === 'status' && [...args].every((arg) => arg === '--json');

  if (!isBuild && !isStatus) {
    console.error(USAGE);

    return 2;
  }

  try {
    const project = ProjectConfig.readAtlasProject();

    if (isStatus) {
      const status = GraphStatus.of({ root: project.root, project });

      console.log(args.has('--json') ? JSON.stringify(status) : GraphStatus.describe({ status }));

      return 0;
    }

    const built = GraphBuild.run({ root: project.root, project, full: args.has('--full') });

    if (built === undefined) {
      console.error(
        'vulcan x atlas graph: git cannot list the tracked files (not a repository, git missing, a timeout, or too many files)',
      );

      return 1;
    }

    const { graph, plan } = built;
    const bytes = statSync(join(project.root, GraphFiles.DIRECTORY, GraphFiles.CODE)).size;
    const files = graph.nodes.filter((node) => node.kind === GraphNodeKinds.FILE).length;
    const symbols = graph.nodes.filter((node) => node.kind === GraphNodeKinds.SYMBOL).length;

    console.log(
      `graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${files} files, ${symbols} symbols, commit ${graph.source.commit ?? 'none'}, ${plan.decision} (${plan.reason}) -> ${GraphFiles.DIRECTORY}/${GraphFiles.CODE}`,
    );

    if (CodeGraph.isOverTarget({ bytes })) {
      console.error(
        `vulcan x atlas graph: ${GraphFiles.CODE} is ${(bytes / 1024 / 1024).toFixed(1)} MB, over the ${GraphConstants.SIZE_TARGET_BYTES / 1024 / 1024} MB target`,
      );
    }

    if (built.error !== undefined) {
      console.error(
        `vulcan x atlas graph: no symbols in the graph, the reader failed: ${built.error}`,
      );
    }

    return 0;
  } catch (error) {
    console.error(
      `vulcan x atlas graph: ${error instanceof Error ? error.message : String(error)}`,
    );

    return 1;
  }
};
