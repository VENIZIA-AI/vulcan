import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IAtlasProject } from '@/common/project-config';
import { CodeProducer } from './code-producer';
import type { ISymbolRecord } from '@/symbols/common/types';
import { SymbolProducer } from './symbol-producer';
import { GraphConstants, GraphFiles, GraphNodeKinds } from './common/constants';
import { GraphOrder } from './common/order';
import type { ICodeGraph, IGraphPart } from './common/types';
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
    /** Symbol nodes and edges kept from the last graph, for the packages whose symbols were not read again. */
    keep?: IGraphPart;
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
    const idsOf = (kind: string): Set<string> =>
      new Set(code.nodes.filter((node) => node.kind === kind).map((node) => node.id));
    const symbols = new SymbolProducer().produce({
      records: opts.records ?? [],
      entryIds: idsOf(GraphNodeKinds.ENTRY),
      fileIds: idsOf(GraphNodeKinds.FILE),
    });

    return {
      schemaVersion: GraphConstants.SCHEMA_VERSION,
      kind: GraphConstants.KIND_CODE,
      source: {
        ...(commit === undefined ? {} : { commit }),
        dirty: GitState.isDirty({ root: opts.root, paths: scope }),
        scope,
      },
      ...CodeGraph.joined({
        parts: [code, symbols, ...(opts.keep === undefined ? [] : [opts.keep])],
      }),
    };
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

  /** The parts as one sorted graph; an edge whose end is not a node of it is dropped, so no part can leave a dangling edge. */
  private static joined(opts: { parts: IGraphPart[] }): IGraphPart {
    const nodes = new Map(opts.parts.flatMap((part) => part.nodes).map((node) => [node.id, node]));
    const edges = new Map(
      opts.parts
        .flatMap((part) => part.edges)
        .filter((edge) => nodes.has(edge.from) && nodes.has(edge.to))
        .map((edge) => [`${edge.kind}\0${edge.from}\0${edge.to}`, edge]),
    );

    return {
      nodes: [...nodes.values()].sort((a, b) => GraphOrder.byText(a.id, b.id)),
      edges: [...edges.values()].sort((a, b) => GraphOrder.byEdge(a, b)),
    };
  }

  /** Whether a graph's text is over the size the format is held to. */
  static isOverTarget(opts: { bytes: number }): boolean {
    return opts.bytes > GraphConstants.SIZE_TARGET_BYTES;
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
