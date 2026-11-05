import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IAtlasProject } from '@/common/project-config';
import type { ISymbolRecord } from '@/symbols/common/types';
import { CodeGraph } from './code-graph';
import {
  GraphConstants,
  GraphDecisions,
  GraphEdgeKinds,
  GraphFiles,
  GraphNodeKinds,
} from './common/constants';
import type { ICodeGraph, IGraphPart } from './common/types';
import { Fingerprints } from './fingerprints';
import { GitState } from './git-state';
import { GraphMeta } from './graph-meta';
import { GraphSymbols } from './graph-symbols';
import { RebuildPlan } from './rebuild-plan';
import type { IRebuildPlan } from './rebuild-plan';

export interface IGraphBuild {
  plan: IRebuildPlan;
  graph: ICodeGraph;
  /** HEAD at the build: the graph file of a skip keeps the commit of the build that wrote it. */
  commit?: string;
  /** The reason the symbols could not be read, when the reader failed. */
  error?: string;
}

/** One build: compare with the last, do as little as the comparison allows, write the files in an order that never lies. */
export class GraphBuild {
  /**
   * Files first (the graph), then the fingerprints, then `meta.json`: a build that stops half way leaves a meta that still
   * describes the graph before it, never one that claims the new graph. Undefined when git cannot list the files.
   */
  static run(opts: {
    root: string;
    project: IAtlasProject;
    full?: boolean;
    /** The reader of the exported symbols; a test gives its own. */
    read?: (opts: { project: IAtlasProject }) => ISymbolRecord[];
  }): IGraphBuild | undefined {
    const scope = opts.project.packages
      .filter((item) => !item.retired)
      .map((item) => item.path)
      .sort();
    const files = GitState.trackedFiles({ root: opts.root, paths: scope });

    if (files === undefined) {
      return undefined;
    }

    const before = Fingerprints.read({ root: opts.root });
    const after = Fingerprints.of({ root: opts.root, project: opts.project, files });
    const previous = GraphBuild.previousGraph({ root: opts.root });
    const plan = RebuildPlan.decide({
      before,
      after,
      full: opts.full === true,
      hasGraph: previous !== undefined,
      dependents: GraphBuild.dependentsOf({ graph: previous }),
    });
    let graph = previous;
    let error: string | undefined;

    if (plan.decision !== GraphDecisions.SKIP || graph === undefined) {
      const isFull = plan.decision === GraphDecisions.FULL;
      const read = GraphSymbols.recordsOf({
        project: isFull
          ? opts.project
          : {
              ...opts.project,
              packages: opts.project.packages.filter((item) => plan.packages.includes(item.name)),
            },
        read: opts.read,
      });

      error = read.error;
      graph = CodeGraph.build({
        root: opts.root,
        project: opts.project,
        records: read.records,
        keep: isFull
          ? undefined
          : GraphBuild.keptSymbols({ graph: previous, rebuilt: plan.packages }),
      });

      if (graph === undefined) {
        return undefined;
      }

      CodeGraph.write({ root: opts.root, graph });
    }

    // A graph written without symbols must not become the baseline a later build skips from.
    Fingerprints.write({
      root: opts.root,
      fingerprints: error === undefined ? after : { ...after, inputs: GraphConstants.INCOMPLETE },
    });
    GraphMeta.write({
      root: opts.root,
      meta: {
        schemaVersion: GraphMeta.SCHEMA_VERSION,
        builtAt: new Date().toISOString(),
        ...GraphBuild.headOf({ root: opts.root }),
        dirty: GitState.isDirty({ root: opts.root, paths: scope }),
        scope,
        decision: plan.decision,
      },
    });

    return {
      plan,
      graph,
      ...GraphBuild.headOf({ root: opts.root }),
      ...(error === undefined ? {} : { error }),
    };
  }

  private static headOf(opts: { root: string }): { commit?: string } {
    const commit = GitState.commitOf({ root: opts.root });

    return commit === undefined ? {} : { commit };
  }

  /** The graph the last build wrote; undefined when there is none or it cannot be read. */
  private static previousGraph(opts: { root: string }): ICodeGraph | undefined {
    const file = join(opts.root, GraphFiles.DIRECTORY, GraphFiles.CODE);

    if (!existsSync(file)) {
      return undefined;
    }

    try {
      const parsed: ICodeGraph = JSON.parse(readFileSync(file, 'utf8'));

      return parsed.schemaVersion === GraphConstants.SCHEMA_VERSION &&
        parsed.kind === GraphConstants.KIND_CODE
        ? parsed
        : undefined;
    } catch {
      return undefined;
    }
  }

  /** For each package, the packages that depend on it (the `depends` edges of the last graph). */
  private static dependentsOf(opts: { graph?: ICodeGraph }): Map<string, string[]> {
    const dependents = new Map<string, string[]>();
    const name = (id: string): string => id.slice('pkg:'.length);

    for (const edge of opts.graph?.edges ?? []) {
      if (edge.kind === GraphEdgeKinds.DEPENDS) {
        dependents.set(name(edge.to), [...(dependents.get(name(edge.to)) ?? []), name(edge.from)]);
      }
    }

    return dependents;
  }

  /** The symbol nodes of the packages that are not read again, with the edges that touch them. */
  private static keptSymbols(opts: {
    graph?: ICodeGraph;
    rebuilt: string[];
  }): IGraphPart | undefined {
    if (opts.graph === undefined) {
      return undefined;
    }

    const nodes = opts.graph.nodes.filter(
      (node) =>
        node.kind === GraphNodeKinds.SYMBOL &&
        node.package !== undefined &&
        !opts.rebuilt.includes(node.package),
    );
    const ids = new Set(nodes.map((node) => node.id));
    // A symbol is reached by an `exports` from its entry and a `contains` from its file; `uses` stays inside a package.
    const edges = opts.graph.edges.filter((edge) =>
      edge.kind === GraphEdgeKinds.USES
        ? ids.has(edge.from) && ids.has(edge.to)
        : (edge.kind === GraphEdgeKinds.EXPORTS || edge.kind === GraphEdgeKinds.CONTAINS) &&
          ids.has(edge.to),
    );

    return { nodes, edges };
  }
}
