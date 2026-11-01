import { EdgeSides } from './compare-schema.ts';
import type { TCompare } from './compare-schema.ts';

/** The part of a page spec the compare view lives in. */
export interface ICompareSpec {
  compare?: TCompare | undefined;
}

interface ICell {
  row: number;
  col: number;
}

/** What a schema cannot say about the compare view: ids, ends of arrows, the grid, and that something differs. */
export class CompareChecks {
  /** The boxes an arrow would cross: along the source's row to the target's column, then along that column. */
  private static blockersOf(opts: {
    from: ICell;
    to: ICell;
    cells: Map<string, string>;
  }): string[] {
    const { from, to, cells } = opts;
    const crossed: ICell[] = [];
    const between = (start: number, end: number): number[] => {
      const sign = end > start ? 1 : -1;
      const found: number[] = [];

      for (let at = start + sign; start !== end && at !== end; at += sign) {
        found.push(at);
      }

      return found;
    };

    for (const col of between(from.col, to.col)) {
      crossed.push({ row: from.row, col });
    }

    if (from.row !== to.row && from.col !== to.col) {
      crossed.push({ row: from.row, col: to.col });
    }

    for (const row of between(from.row, to.row)) {
      crossed.push({ row, col: to.col });
    }

    return crossed.flatMap((cell) => cells.get(`${cell.row},${cell.col}`) ?? []);
  }

  static check(opts: { spec: ICompareSpec }): string[] {
    const { compare } = opts.spec;

    if (compare === undefined) {
      return [];
    }

    const problems: string[] = [];
    const ids = new Set<string>();
    const cells = new Map<string, string>();
    const positions = new Map<string, ICell>();

    for (const node of compare.nodes) {
      if (ids.has(node.id)) {
        problems.push(`compare.nodes: id '${node.id}' is used twice`);
      }

      ids.add(node.id);

      const owner = cells.get(`${node.row},${node.col}`);

      if (owner !== undefined) {
        problems.push(
          `compare.nodes: '${node.id}' and '${owner}' are both in row ${node.row}, col ${node.col}`,
        );
      }

      cells.set(`${node.row},${node.col}`, node.id);
      positions.set(node.id, { row: node.row, col: node.col });
    }

    const names = new Set<string>();

    for (const edge of compare.edges) {
      const name = `${edge.from}>${edge.to}`;

      for (const end of [edge.from, edge.to]) {
        if (!ids.has(end)) {
          problems.push(`compare.edges: '${name}' names '${end}', which is not a node`);
        }
      }

      if (edge.from === edge.to) {
        problems.push(`compare.edges: '${name}' loops to itself`);
      }

      if (names.has(name)) {
        problems.push(`compare.edges: '${name}' is drawn twice`);
      }

      if (names.has(`${edge.to}>${edge.from}`)) {
        problems.push(
          `compare.edges: '${name}' and '${edge.to}>${edge.from}' run on the same line - draw one arrow, or put the boxes in another place`,
        );
      }

      names.add(name);

      const from = positions.get(edge.from);
      const to = positions.get(edge.to);

      if (from !== undefined && to !== undefined && edge.from !== edge.to) {
        for (const blocker of CompareChecks.blockersOf({ from, to, cells })) {
          problems.push(
            `compare.edges: '${name}' would be drawn through box '${blocker}' - move a box`,
          );
        }
      }
    }

    if (!compare.edges.some((edge) => (edge.in ?? EdgeSides.BOTH) !== EdgeSides.BOTH)) {
      problems.push("compare: no edge differs between 'a' and 'b'");
    }

    return problems;
  }
}
