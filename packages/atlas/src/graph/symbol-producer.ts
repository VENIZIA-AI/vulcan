import type { IAtlasPackage } from '@/common/project-config';
import type { ISymbolRecord } from '@/symbols/common/types';
import { GraphEdgeKinds, GraphIdPrefixes, GraphNodeKinds } from './common/constants';
import type { IGraphEdge, IGraphNode, IGraphPart, IGraphProducer } from './common/types';

/** The exported symbols of the project and how they refer to each other, from the records atlas already reads. */
export class SymbolProducer implements IGraphProducer<{
  records: ISymbolRecord[];
  packages: IAtlasPackage[];
  /** The ids of the file nodes of the graph: a symbol is attached to the file it is declared in when that file is there. */
  fileIds: ReadonlySet<string>;
}> {
  readonly kinds = [GraphNodeKinds.SYMBOL];

  produce(opts: {
    records: ISymbolRecord[];
    packages: IAtlasPackage[];
    fileIds: ReadonlySet<string>;
  }): IGraphPart {
    const nodes = new Map<string, IGraphNode>();
    const edges = new Map<string, IGraphEdge>();
    const addEdge = (edge: IGraphEdge): void => {
      edges.set(`${edge.kind}\0${edge.from}\0${edge.to}`, edge);
    };
    const nameOf = new Map(opts.packages.map((item) => [item.dir, item.name]));
    const records = opts.records.map((record) => ({ record, id: SymbolProducer.idOf({ record }) }));
    const byName = new Map<string, { record: ISymbolRecord; id: string }[]>();

    for (const item of records) {
      byName.set(item.record.name, [...(byName.get(item.record.name) ?? []), item]);
    }

    for (const { record, id } of records) {
      const entryId = `${GraphIdPrefixes.ENTRY}${record.specifier}`;
      const fileId = `${GraphIdPrefixes.FILE}${record.file}`;
      const owner = nameOf.get(record.package) ?? record.package;

      nodes.set(id, {
        id,
        kind: GraphNodeKinds.SYMBOL,
        name: record.name,
        package: owner,
        symbol: {
          kind: record.kind,
          line: record.line,
          documented: record.doc !== undefined && record.doc !== '',
          ...(record.shape === undefined ? {} : { shape: record.shape }),
          ...(record.external === true ? { thirdParty: true } : {}),
        },
      });
      addEdge({ from: entryId, to: id, kind: GraphEdgeKinds.EXPORTS });

      if (record.external !== true && opts.fileIds.has(fileId)) {
        addEdge({ from: fileId, to: id, kind: GraphEdgeKinds.CONTAINS });
      }

      for (const used of record.uses ?? []) {
        const target = SymbolProducer.resolve({ name: used, from: record, candidates: byName });

        if (target !== undefined && target !== id) {
          addEdge({ from: id, to: target, kind: GraphEdgeKinds.USES });
        }
      }
    }

    return {
      nodes: [...nodes.values()].sort((a, b) => SymbolProducer.byText(a.id, b.id)),
      edges: [...edges.values()],
    };
  }

  private static idOf(opts: { record: ISymbolRecord }): string {
    return `${GraphIdPrefixes.SYMBOL}${opts.record.specifier}#${opts.record.name}`;
  }

  private static byText(a: string, b: string): number {
    if (a === b) {
      return 0;
    }

    return a < b ? -1 : 1;
  }

  /**
   * The symbol a `uses` name stands for. Records hold names only, so: the symbol of that name in the same entry; else the
   * only one in the same package; else the only one in the project. Several candidates at the last step give nothing: an
   * ambiguous name is not guessed.
   */
  private static resolve(opts: {
    name: string;
    from: ISymbolRecord;
    candidates: ReadonlyMap<string, { record: ISymbolRecord; id: string }[]>;
  }): string | undefined {
    const all = opts.candidates.get(opts.name) ?? [];
    const sameEntry = all.filter((item) => item.record.specifier === opts.from.specifier);

    if (sameEntry.length === 1) {
      return sameEntry[0]?.id;
    }

    const samePackage = all.filter((item) => item.record.package === opts.from.package);

    if (samePackage.length === 1) {
      return samePackage[0]?.id;
    }

    return samePackage.length === 0 && all.length === 1 ? all[0]?.id : undefined;
  }
}
