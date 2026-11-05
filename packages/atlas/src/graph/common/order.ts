/** The one order the graph is sorted in: code units, the same on every machine. */
export class GraphOrder {
  static byText(a: string, b: string): number {
    if (a === b) {
      return 0;
    }

    return a < b ? -1 : 1;
  }

  /** Edges by kind, then from, then to. */
  static byEdge(
    a: { kind: string; from: string; to: string },
    b: { kind: string; from: string; to: string },
  ): number {
    return (
      GraphOrder.byText(a.kind, b.kind) ||
      GraphOrder.byText(a.from, b.from) ||
      GraphOrder.byText(a.to, b.to)
    );
  }
}
