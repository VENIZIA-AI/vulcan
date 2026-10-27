import { NodeStates } from './constants.ts';
import type { TChrome } from './constants.ts';
import { stateIcon } from './charts.ts';
import { iconSvg } from './icons.ts';
import { escapeText } from './layout.ts';
import type { TVisualizeSpec } from './schema.ts';

type TDiagram = NonNullable<NonNullable<TVisualizeSpec['explainer']>['steps'][number]['diagram']>;
type TArchitecture = NonNullable<TVisualizeSpec['architecture']>;

/** A drawing, the width it needs to keep its text readable, and the list that replaces it on a phone. */
export interface IDrawing {
  svg: string;
  width: number;
  fallback: string;
}

const escaped = (value: string): string => escapeText({ value });

const box = (opts: {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  sub?: string;
  tone?: string;
  icon?: string;
}): string => {
  const { x, y, width, height } = opts;
  const text = opts.icon === undefined ? 14 : 38;

  return `<g class="dbox${opts.tone === undefined ? '' : ` c-${opts.tone}`}"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="4"/>${opts.icon === undefined ? '' : `<g class="st" transform="translate(${x + 10} ${y + height / 2 - 10})">${opts.icon.replace('<svg', '<svg x="0" y="0"')}</g>`}<text class="t" x="${opts.icon === undefined ? x + width / 2 : x + text}" y="${y + height / 2 + (opts.sub === undefined ? 5 : -3)}" text-anchor="${opts.icon === undefined ? 'middle' : 'start'}">${escaped(opts.label)}</text>${opts.sub === undefined ? '' : `<text class="s" x="${opts.icon === undefined ? x + width / 2 : x + text}" y="${y + height / 2 + 15}" text-anchor="${opts.icon === undefined ? 'middle' : 'start'}">${escaped(opts.sub)}</text>`}</g>`;
};

const arrowHead = (opts: { x: number; y: number }): string =>
  `<path d="M${opts.x - 7} ${opts.y - 5}L${opts.x} ${opts.y}L${opts.x - 7} ${opts.y + 5}" fill="none" class="dline"/>`;

/** An explainer step's diagram: a row of boxes joined by labelled arrows, or stacked layers. */
export const renderDiagram = (opts: { diagram: TDiagram }): IDrawing => {
  const { diagram } = opts;

  if (diagram.type === 'row') {
    const longest = Math.max(
      ...diagram.nodes.flatMap((node) => [node.label.length * 8.2, (node.sub?.length ?? 0) * 7.6]),
    );
    const bw = Math.max(124, Math.ceil(longest) + 24);
    const gap = 78;
    const width = diagram.nodes.length * bw + (diagram.nodes.length - 1) * gap + 16;
    const parts = diagram.nodes
      .map((node, index) => {
        const x = 8 + index * (bw + gap);
        const label = diagram.arrows?.[index];
        const arrow =
          index < diagram.nodes.length - 1
            ? `<path d="M${x + bw + 4} 40H${x + bw + gap - 4}" class="dline"/>${arrowHead({ x: x + bw + gap - 4, y: 40 })}${label === undefined ? '' : `<text class="dl" x="${x + bw + gap / 2}" y="30" text-anchor="middle">${escaped(label)}</text>`}`
            : '';

        return `${box({ x, y: 12, width: bw, height: 56, label: node.label, sub: node.sub })}${arrow}`;
      })
      .join('');

    return {
      svg: `<svg width="${width}" viewBox="0 0 ${width} 80" role="group" aria-label="diagram">${parts}</svg>`,
      width,
      fallback: `<ol class="path">${diagram.nodes
        .map(
          (node, index) =>
            `<li><b>${escaped(node.label)}</b>${node.sub === undefined ? '' : ` <span class="mut">${escaped(node.sub)}</span>`}${index < diagram.nodes.length - 1 && diagram.arrows?.[index] !== undefined ? `<span class="verb">${escaped(diagram.arrows[index] ?? '')}</span>` : ''}</li>`,
        )
        .join('')}</ol>`,
    };
  }

  const most = Math.max(...diagram.layers.map((layer) => layer.items.length));
  const label = Math.max(
    112,
    Math.ceil(Math.max(...diagram.layers.map((layer) => layer.label.length)) * 8.8) + 30,
  );
  const iw = Math.max(
    112,
    Math.ceil(
      Math.max(...diagram.layers.flatMap((layer) => layer.items.map((item) => item.length))) * 8,
    ) + 24,
  );
  const width = label + most * (iw + 10) + 14;
  const parts = diagram.layers
    .map((layer, row) => {
      const y = 8 + row * 62;

      return `<g><rect x="4" y="${y}" width="${width - 8}" height="54" rx="4" class="dband"/><text class="dlab" x="14" y="${y + 31}">${escaped(layer.label)}</text>${layer.items.map((item, col) => box({ x: label + col * (iw + 10), y: y + 8, width: iw, height: 38, label: item })).join('')}</g>`;
    })
    .join('');

  return {
    svg: `<svg width="${width}" viewBox="0 0 ${width} ${diagram.layers.length * 62 + 12}" role="group" aria-label="layers">${parts}</svg>`,
    width,
    fallback: `<ul class="path">${diagram.layers.map((layer) => `<li><b>${escaped(layer.label)}</b>: ${layer.items.map(escaped).join(', ')}</li>`).join('')}</ul>`,
  };
};

/** The layered view: bands from top to bottom, boxes in each, and an elbow line for every link. */
export const renderArchitecture = (opts: {
  architecture: TArchitecture;
  chrome: TChrome;
}): IDrawing => {
  const { architecture } = opts;
  const most = Math.max(...architecture.layers.map((layer) => layer.boxes.length));
  const label = 120;
  const bw = 176;
  const bh = 68;
  const gap = 64;
  const rowHeight = 190;
  const width = label + most * (bw + gap) + 4;
  const height = architecture.layers.length * rowHeight + 8;
  const positions = new Map<string, { x: number; y: number; row: number }>();

  architecture.layers.forEach((layer, row) => {
    const total = layer.boxes.length * (bw + gap) - gap;
    const start = label + (most * (bw + gap) - gap - total) / 2;

    layer.boxes.forEach((boxSpec, col) =>
      positions.set(boxSpec.id, { x: start + col * (bw + gap), y: 4 + row * rowHeight + 34, row }),
    );
  });

  const bands = architecture.layers
    .map(
      (layer, row) =>
        `<rect x="2" y="${4 + row * rowHeight}" width="${width - 4}" height="${rowHeight - 14}" rx="4" class="dband"/><text class="dlab" x="14" y="${4 + row * rowHeight + 24}">${escaped(layer.label)}</text>`,
    )
    .join('');
  // Links that cross the same gap between two layers get their own horizontal run, so no two lines share one.
  const lanes = new Map<number, number>();
  const across = new Map<number, number>();

  for (const link of architecture.links) {
    const from = positions.get(link.from);
    const to = positions.get(link.to);

    if (from !== undefined && to !== undefined && from.row !== to.row) {
      across.set(Math.min(from.row, to.row), (across.get(Math.min(from.row, to.row)) ?? 0) + 1);
    }
  }

  const links = architecture.links
    .map((link) => {
      const a = positions.get(link.from);
      const b = positions.get(link.to);

      if (a === undefined || b === undefined) {
        return '';
      }

      if (a.row === b.row) {
        const sign = a.x < b.x ? 1 : -1;
        const x1 = sign === 1 ? a.x + bw : a.x;
        const x2 = sign === 1 ? b.x : b.x + bw;
        const y = a.y + bh / 2;

        return `<g class="dlink"><path d="M${x1} ${y}H${x2}" class="dline"/><path d="M${x2 - sign * 7} ${y - 5}L${x2} ${y}L${x2 - sign * 7} ${y + 5}" fill="none" class="dline"/>${link.label === undefined ? '' : `<text class="dl" x="${(x1 + x2) / 2}" y="${y - 8}" text-anchor="middle">${escaped(link.label)}</text>`}</g>`;
      }

      const down = a.row < b.row;
      const gapIndex = Math.min(a.row, b.row);
      const lane = lanes.get(gapIndex) ?? 0;

      lanes.set(gapIndex, lane + 1);

      const top = 4 + gapIndex * rowHeight + 34 + bh;
      const bottom = 4 + (gapIndex + 1) * rowHeight + 34;
      const ym = top + 14 + ((bottom - top - 28) * (lane + 1)) / ((across.get(gapIndex) ?? 1) + 1);
      const shift = lane % 3 === 1 ? 10 : lane % 3 === 2 ? -10 : 0;
      const x1 = a.x + bw / 2 + shift;
      const x2 = b.x + bw / 2 + shift;
      const y1 = down ? a.y + bh : a.y;
      const y2 = down ? b.y : b.y + bh;
      const tip = down ? -7 : 7;

      return `<g class="dlink"><path d="M${x1} ${y1}V${ym}H${x2}V${y2}" class="dline"/><path d="M${x2 - 5} ${y2 + tip}L${x2} ${y2}L${x2 + 5} ${y2 + tip}" fill="none" class="dline"/>${link.label === undefined ? '' : `<text class="dl" x="${(x1 + x2) / 2}" y="${ym - 5}" text-anchor="middle">${escaped(link.label)}</text>`}</g>`;
    })
    .join('');
  const boxes = architecture.layers
    .flatMap((layer) => layer.boxes)
    .map((spec) => {
      const p = positions.get(spec.id);

      return p === undefined
        ? ''
        : box({
            x: p.x,
            y: p.y,
            width: bw,
            height: bh,
            label: spec.label,
            sub: spec.sub,
            tone: spec.state === undefined ? undefined : NodeStates.toneOf(spec.state),
            icon: spec.state === undefined ? undefined : stateIcon({ state: spec.state, size: 20 }),
          });
    })
    .join('');
  const names = new Map(
    architecture.layers.flatMap((layer) =>
      layer.boxes.map((spec) => [spec.id, spec.label] as const),
    ),
  );

  return {
    svg: `<svg width="${width}" viewBox="0 0 ${width} ${height}" role="group" aria-label="${escaped(opts.chrome.architecture)}">${bands}${links}${boxes}</svg>`,
    width,
    fallback: `<ul class="path">${architecture.layers.map((layer) => `<li><b>${escaped(layer.label)}</b>: ${layer.boxes.map((spec) => `${spec.state === undefined ? '' : `<span class="c-${NodeStates.toneOf(spec.state)} inl">${stateIcon({ state: spec.state, size: 16 })}</span>`}${escaped(spec.label)}`).join(', ')}</li>`).join('')}${architecture.links.map((link) => `<li>${escaped(names.get(link.from) ?? link.from)} <span class="verb">${escaped(link.label ?? opts.chrome.uses)}</span> ${escaped(names.get(link.to) ?? link.to)}</li>`).join('')}</ul>`,
  };
};

/** The idea map: the centre between two columns of branches, each branch a cluster of ideas. */
export const renderIdeaMap = (opts: { map: NonNullable<TVisualizeSpec['ideaMap']> }): string => {
  const { map } = opts;
  const cluster = (branch: (typeof map.branches)[number], index: number): string =>
    `<li class="branch" data-s="${(index % 5) + 1}"><h3><i class="sw" data-s="${(index % 5) + 1}"></i>${escaped(branch.label)}</h3><ul class="chips">${branch.items.map((item) => `<li>${escaped(item)}</li>`).join('')}</ul>${branch.note === undefined ? '' : `<p class="mut">${escaped(branch.note)}</p>`}</li>`;
  const left = map.branches.filter((_, index) => index % 2 === 0);
  const right = map.branches.filter((_, index) => index % 2 === 1);

  return `<div class="idea"><ul class="side l">${left.map((branch, i) => cluster(branch, i * 2)).join('')}</ul><div class="centre">${iconSvg({ name: 'star', size: 22 })}<b>${escaped(map.center)}</b></div><ul class="side r">${right.map((branch, i) => cluster(branch, i * 2 + 1)).join('')}</ul></div>`;
};
