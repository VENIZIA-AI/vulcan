import type { ISymbolRecord } from '@/symbols/common/types';
import { GraphEdgeKinds, GraphIdPrefixes, GraphNodeKinds } from './common/constants';
import { GraphOrder } from './common/order';
import type { IGraphEdge, IGraphNode, IGraphPart, IGraphProducer } from './common/types';

interface IPlaced {
  record: ISymbolRecord;
  id: string;
}

/** The exported symbols of the project and how they refer to each other, from the records atlas already reads. */
export class SymbolProducer implements IGraphProducer<{
  records: ISymbolRecord[];
  /** The ids of the entry nodes of the graph: a symbol of an entry the graph does not hold is left out. */
  entryIds: ReadonlySet<string>;
  /** The ids of the file nodes of the graph: a symbol is attached to the file it is declared in when that file is there. */
  fileIds: ReadonlySet<string>;
}> {
  readonly kinds = [GraphNodeKinds.SYMBOL];

  produce(opts: {
    records: ISymbolRecord[];
    entryIds: ReadonlySet<string>;
    fileIds: ReadonlySet<string>;
  }): IGraphPart {
    const nodes = new Map<string, IGraphNode>();
    const edges = new Map<string, IGraphEdge>();
    const addEdge = (edge: IGraphEdge): void => {
      edges.set(`${edge.kind}\0${edge.from}\0${edge.to}`, edge);
    };
    const placed = opts.records
      .filter((record) => opts.entryIds.has(`${GraphIdPrefixes.ENTRY}${record.specifier}`))
      .map((record) => ({ record, id: SymbolProducer.idOf({ record }) }));
    const byName = new Map<string, IPlaced[]>();

    for (const item of placed) {
      byName.set(item.record.name, [...(byName.get(item.record.name) ?? []), item]);
    }

    for (const { record, id } of placed) {
      const fileId = `${GraphIdPrefixes.FILE}${record.file}`;

      nodes.set(id, {
        id,
        kind: GraphNodeKinds.SYMBOL,
        name: record.name,
        package: record.package,
        symbol: {
          kind: record.kind,
          line: record.line,
          documented: record.doc !== undefined && record.doc !== '',
          // The digest of a built declaration. A source-published symbol's digest covers its body, so it is left out.
          ...(record.shape === undefined || record.declaration === undefined
            ? {}
            : { shape: record.shape }),
          ...(record.external === true ? { thirdParty: true } : {}),
        },
      });
      addEdge({
        from: `${GraphIdPrefixes.ENTRY}${record.specifier}`,
        to: id,
        kind: GraphEdgeKinds.EXPORTS,
      });

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
      nodes: [...nodes.values()].sort((a, b) => GraphOrder.byText(a.id, b.id)),
      edges: [...edges.values()].sort((a, b) => GraphOrder.byEdge(a, b)),
    };
  }

  private static idOf(opts: { record: ISymbolRecord }): string {
    return `${GraphIdPrefixes.SYMBOL}${opts.record.specifier}#${opts.record.name}`;
  }

  /**
   * The symbol a `uses` name stands for. Records hold names only, and a name can be a type of a dependency or one that is
   * not exported, so only the package's own symbols are followed: the symbol of that name in the same entry, else the only
   * one in the same package. Several candidates give nothing; a name that is only exported by another package gives
   * nothing either, because it may as well be a dependency's type that shares the name.
   */
  private static resolve(opts: {
    name: string;
    from: ISymbolRecord;
    candidates: ReadonlyMap<string, IPlaced[]>;
  }): string | undefined {
    const samePackage = (opts.candidates.get(opts.name) ?? []).filter(
      (item) => item.record.package === opts.from.package,
    );
    const sameEntry = samePackage.filter((item) => item.record.specifier === opts.from.specifier);

    if (sameEntry.length === 1) {
      return sameEntry[0]?.id;
    }

    return samePackage.length === 1 ? samePackage[0]?.id : undefined;
  }
}
