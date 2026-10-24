import type { TVisualizeSpec } from './schema.ts';

interface ICell {
  row: number;
  col: number;
}

/** The boxes an arrow would cross: along the source's row to the target's column, then along that column. */
const blockersOf = (opts: { from: ICell; to: ICell; cells: Map<string, string> }): string[] => {
  const { from, to, cells } = opts;
  const crossed: ICell[] = [];
  const step = (start: number, end: number): number[] => {
    if (start === end) {
      return [];
    }

    const sign = end > start ? 1 : -1;
    const between: number[] = [];

    for (let at = start + sign; at !== end; at += sign) {
      between.push(at);
    }

    return between;
  };

  for (const col of step(from.col, to.col)) {
    crossed.push({ row: from.row, col });
  }

  if (from.row !== to.row && from.col !== to.col) {
    crossed.push({ row: from.row, col: to.col });
  }

  for (const row of step(from.row, to.row)) {
    crossed.push({ row, col: to.col });
  }

  return crossed.flatMap((cell) => cells.get(`${cell.row},${cell.col}`) ?? []);
};

/** What a schema cannot say: ids are unique, every edge and step points at something that exists, a cell holds one box. */
export const checkSpec = (opts: { spec: TVisualizeSpec }): string[] => {
  const problems: string[] = [];
  const { flow } = opts.spec;

  if (flow === undefined) {
    return problems;
  }

  const ids = new Set<string>();
  const cells = new Map<string, string>();
  const positions = new Map<string, { cell: ICell }>();

  for (const node of flow.nodes) {
    if (ids.has(node.id)) {
      problems.push(`flow.nodes: id '${node.id}' is used twice`);
    }

    ids.add(node.id);

    const cell = `${node.row},${node.col}`;
    const owner = cells.get(cell);

    if (owner !== undefined) {
      problems.push(
        `flow.nodes: '${node.id}' and '${owner}' are both in row ${node.row}, col ${node.col}`,
      );
    }

    cells.set(cell, node.id);
    positions.set(node.id, { cell: { row: node.row, col: node.col } });
  }

  const edges = new Set<string>();

  for (const edge of flow.edges) {
    for (const end of [edge.from, edge.to]) {
      if (!ids.has(end)) {
        problems.push(`flow.edges: '${edge.from}>${edge.to}' names '${end}', which is not a node`);
      }
    }

    if (edge.from === edge.to) {
      problems.push(`flow.edges: '${edge.from}>${edge.to}' loops to itself`);
    }

    const name = `${edge.from}>${edge.to}`;

    if (edges.has(name)) {
      problems.push(`flow.edges: '${name}' is drawn twice`);
    }

    if (edges.has(`${edge.to}>${edge.from}`)) {
      problems.push(
        `flow.edges: '${name}' and '${edge.to}>${edge.from}' run on the same line - draw one arrow, or put the boxes in another place`,
      );
    }

    edges.add(name);

    const from = positions.get(edge.from);
    const to = positions.get(edge.to);

    if (from !== undefined && to !== undefined && edge.from !== edge.to) {
      for (const blocker of blockersOf({ from: from.cell, to: to.cell, cells })) {
        problems.push(`flow.edges: '${name}' would be drawn through box '${blocker}' - move a box`);
      }
    }
  }

  for (const [index, step] of flow.steps.entries()) {
    for (const id of step.nodes) {
      if (!ids.has(id)) {
        problems.push(`flow.steps[${index}]: node '${id}' does not exist`);
      }
    }

    for (const name of step.edges) {
      if (!edges.has(name)) {
        problems.push(`flow.steps[${index}]: edge '${name}' does not exist`);
      }
    }
  }

  return problems;
};
