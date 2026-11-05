import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IAtlasProject } from '@/common/project-config';
import { CodeProducer } from './code-producer';
import type { ISymbolRecord } from '@/symbols/common/types';
import { SymbolProducer } from './symbol-producer';
import { GraphConstants, GraphEdgeKinds, GraphFiles, GraphNodeKinds } from './common/constants';
import type { ICodeGraph } from './common/types';
import { GitState } from './git-state';

export class CodeGraph {
  /**
   * The code graph of the project at its working tree. Undefined when git cannot list the files: the graph is of tracked
   * files, so it needs a repository.
   */
  static build(opts: {
    root: string;
    project: IAtlasProject;
    /** The exported symbols atlas read (`SymbolCompute.symbolsOfRepository`); the graph has no symbol nodes without them. */
    records?: ISymbolRecord[];
  }): ICodeGraph | undefined {
    const scope = opts.project.packages
      .filter((item) => !item.retired)
      .map((item) => item.path)
      .sort();
    const files = GitState.trackedFiles({ root: opts.root, paths: scope });

    if (files === undefined) {
      return undefined;
    }

    const commit = GitState.commitOf({ root: opts.root });
    const code = new CodeProducer().produce({ root: opts.root, project: opts.project, files });
    const symbols = new SymbolProducer().produce({
      records: opts.records ?? [],
      packages: opts.project.packages,
      fileIds: new Set(
        code.nodes.filter((node) => node.kind === GraphNodeKinds.FILE).map((node) => node.id),
      ),
    });
    const entryIds = new Set(
      code.nodes.filter((node) => node.kind === GraphNodeKinds.ENTRY).map((node) => node.id),
    );

    return {
      schemaVersion: GraphConstants.SCHEMA_VERSION,
      kind: GraphConstants.KIND_CODE,
      source: {
        ...(commit === undefined ? {} : { commit }),
        dirty: GitState.isDirty({ root: opts.root, paths: scope }),
        scope,
      },
      nodes: [...code.nodes, ...symbols.nodes].sort((a, b) => CodeGraph.byText(a.id, b.id)),
      edges: [
        ...code.edges,
        ...symbols.edges.filter(
          (edge) => edge.kind !== GraphEdgeKinds.EXPORTS || entryIds.has(edge.from),
        ),
      ].sort(
        (a, b) =>
          CodeGraph.byText(a.kind, b.kind) ||
          CodeGraph.byText(a.from, b.from) ||
          CodeGraph.byText(a.to, b.to),
      ),
    };
  }

  private static byText(a: string, b: string): number {
    if (a === b) {
      return 0;
    }

    return a < b ? -1 : 1;
  }

  /**
   * The file's text: one line for each node and each edge, so a diff of two graphs reads as a list and the file stays small.
   * Same graph, same bytes.
   */
  static render(opts: { graph: ICodeGraph }): string {
    const { graph } = opts;
    const lines = (items: object[]): string =>
      items.map((item) => JSON.stringify(item)).join(',\n');

    return `{"schemaVersion":${graph.schemaVersion},"kind":${JSON.stringify(graph.kind)},"source":${JSON.stringify(graph.source)},\n"nodes":[\n${lines(graph.nodes)}\n],\n"edges":[\n${lines(graph.edges)}\n]}\n`;
  }

  /** Written whole to a temporary name, then renamed: a reader never sees half a file. */
  static write(opts: { root: string; graph: ICodeGraph }): string {
    const directory = join(opts.root, GraphFiles.DIRECTORY);
    const file = join(directory, GraphFiles.CODE);
    const temporary = `${file}.${process.pid}.tmp`;

    mkdirSync(directory, { recursive: true });
    writeFileSync(temporary, CodeGraph.render({ graph: opts.graph }));
    renameSync(temporary, file);

    return file;
  }
}
