import type { TChrome } from './constants.ts';
import { SpecArchitecture } from './architecture.ts';
import { GridSpans } from './grid-span.ts';
import { IconSet } from './icons.ts';
import { FigureLayout } from './layout.ts';
import type { TVisualizeSpec } from './schema.ts';

type TDiagram = NonNullable<NonNullable<TVisualizeSpec['explainer']>['steps'][number]['diagram']>;
type TArchitecture = NonNullable<TVisualizeSpec['architecture']>;

/** A drawing, the width it needs to keep its text readable, and the list that replaces it on a phone. */
export interface IDrawing {
  svg: string;
  width: number;
  fallback: string;
}

const escaped = (value: string): string => FigureLayout.escapeText({ value });

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

export class SpecDiagrams {
  /** An explainer step's diagram: a row of boxes joined by labelled arrows, or stacked layers. */
  static render(opts: { diagram: TDiagram }): IDrawing {
    const { diagram } = opts;

    if (diagram.type === 'row') {
      const longest = Math.max(
        ...diagram.nodes.flatMap((node) => [
          FigureLayout.textWidth({ text: node.label, size: 14, isBold: true }),
          node.sub === undefined ? 0 : FigureLayout.textWidth({ text: node.sub, size: 12.5 }),
        ]),
      );
      const bw = Math.max(124, Math.ceil(longest) + 24);
      const arrowWidth = Math.max(
        0,
        ...(diagram.arrows ?? []).map((label) =>
          FigureLayout.textWidth({ text: label, size: 12.5 }),
        ),
      );
      const gap = Math.max(78, Math.ceil(arrowWidth) + 24);
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
      fallback: `<ul class="path">${diagram.layers.map((layer) => `<li><b>${escaped(layer.label)}:</b> ${layer.items.map(escaped).join(', ')}</li>`).join('')}</ul>`,
    };
  }

  /** The layered view: bands from top to bottom, boxes in each, and a line for every link that never crosses a box. */
  static renderArchitecture(opts: { architecture: TArchitecture; chrome: TChrome }): IDrawing {
    return SpecArchitecture.render(opts);
  }

  /** The idea map: the centre between two columns of branches, each branch a cluster of ideas. */
  static renderIdeaMap(opts: {
    map: NonNullable<TVisualizeSpec['ideaMap']>;
    spans: Set<number>;
  }): string {
    const { map, spans } = opts;
    // Branches alternate left and right, a pair to a row; each takes three rows of the grid (title, chips, note) from it,
    // so the title and the chips of two branches in one row sit at the same height, and the centre spans every row.
    const rows = Math.ceil(map.branches.length / 2) * 3;
    const cluster = (branch: (typeof map.branches)[number], index: number): string =>
      `<li class="branch" data-s="${(index % 5) + 1}"><h3><i class="sw" data-s="${(index % 5) + 1}"></i>${escaped(branch.label)}</h3><ul class="chips">${branch.items.map((item) => `<li>${escaped(item)}</li>`).join('')}</ul>${branch.note === undefined ? '' : `<p class="mut">${escaped(branch.note)}</p>`}</li>`;

    return `<div class="idea"><div class="centre win ${GridSpans.classOf({ count: rows, spans })}">${IconSet.iconSvg({ name: 'star', size: 22 })}<b>${escaped(map.center)}</b></div><ul class="bs" role="list">${map.branches.map((branch, index) => cluster(branch, index)).join('')}</ul></div>`;
  }
}
