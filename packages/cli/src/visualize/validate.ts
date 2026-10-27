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

/** The flow: ids are unique, every edge and step points at something that exists, a cell holds one box. */
const checkFlow = (opts: { flow: NonNullable<TVisualizeSpec['flow']> }): string[] => {
  const problems: string[] = [];
  const { flow } = opts;

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

/** The other kinds: scores match the criteria, links point at boxes, chart data lines up with its labels. */
const checkKinds = (opts: { spec: TVisualizeSpec }): string[] => {
  const problems: string[] = [];
  const { comparison, architecture, findings, explainer, decisionRecord } = opts.spec;

  if (comparison !== undefined) {
    for (const option of comparison.options) {
      if (option.scores.length !== comparison.criteria.length) {
        problems.push(
          `comparison.options: '${option.name}' has ${option.scores.length} scores for ${comparison.criteria.length} criteria`,
        );
      }
    }

    if (comparison.options.filter((option) => option.recommended === true).length > 1) {
      problems.push('comparison.options: only one option can be recommended');
    }
  }

  if (architecture !== undefined) {
    const ids = new Set<string>();

    for (const box of architecture.layers.flatMap((layer) => layer.boxes)) {
      if (ids.has(box.id)) {
        problems.push(`architecture: id '${box.id}' is used twice`);
      }

      ids.add(box.id);
    }

    for (const link of architecture.links) {
      for (const end of [link.from, link.to]) {
        if (!ids.has(end)) {
          problems.push(
            `architecture.links: '${link.from}>${link.to}' names '${end}', which is not a box`,
          );
        }
      }

      if (link.from === link.to) {
        problems.push(`architecture.links: '${link.from}>${link.to}' loops to itself`);
      }
    }
  }

  for (const [index, chart] of (findings?.charts ?? []).entries()) {
    if (chart.type === 'bar' && chart.labels.length !== chart.values.length) {
      problems.push(
        `findings.charts[${index}]: ${chart.labels.length} labels for ${chart.values.length} values`,
      );
    }

    if (chart.type === 'line') {
      for (const series of chart.series) {
        if (series.values.length !== chart.labels.length) {
          problems.push(
            `findings.charts[${index}]: series '${series.name}' has ${series.values.length} values for ${chart.labels.length} labels`,
          );
        }
      }
    }

    if (chart.type === 'donut' && chart.parts.every((part) => part.value === 0)) {
      problems.push(`findings.charts[${index}]: every part of the donut is zero`);
    }
  }

  for (const [index, step] of (explainer?.steps ?? []).entries()) {
    const { diagram } = step;

    if (
      diagram?.type === 'row' &&
      diagram.arrows !== undefined &&
      diagram.arrows.length !== diagram.nodes.length - 1
    ) {
      problems.push(
        `explainer.steps[${index}]: a row of ${diagram.nodes.length} boxes takes ${diagram.nodes.length - 1} arrow labels`,
      );
    }
  }

  if (
    decisionRecord !== undefined &&
    decisionRecord.options.filter((option) => option.chosen === true).length > 1
  ) {
    problems.push('decisionRecord.options: only one option can be chosen');
  }

  return problems;
};

/** What a schema cannot say, for every kind on the page. */
export const checkSpec = (opts: { spec: TVisualizeSpec }): string[] => [
  ...(opts.spec.flow === undefined ? [] : checkFlow({ flow: opts.spec.flow })),
  ...checkKinds({ spec: opts.spec }),
];
