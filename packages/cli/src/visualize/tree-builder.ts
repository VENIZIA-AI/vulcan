import { KindFigureConstants } from './constants.ts';
import type { IKindDrawing } from './common/index.ts';
import { SpecCharts } from './charts.ts';
import type { TChrome } from './constants.ts';
import { FigureLayout } from './layout.ts';
import type { ITreeNode } from './kinds-schema.ts';
import type { TTree } from './kinds-schema.ts';
import { SpecSections } from './sections.ts';
import { KindFigureUtility } from './utilities/kind-figure.utility.ts';

// -----------------------------------------------------------------------------------------------------------------
// Tree
// -----------------------------------------------------------------------------------------------------------------

interface IRow {
  node: ITreeNode;
  depth: number;
  parent: number | undefined;
}

const INDENT = 36;
const TREE_TOP = 12;
const ROW_GAP = 10;

/** The figure of a tree: each node under its parent, one a row. */
export class TreeBuilder {
  static build(opts: { tree: TTree; chrome: TChrome }): IKindDrawing {
    const { tree, chrome } = opts;
    const rows: IRow[] = [];
    const walk = (node: ITreeNode, depth: number, parent: number | undefined): void => {
      const index = rows.length;

      rows.push({ node, depth, parent });

      for (const child of node.children ?? []) {
        walk(child, depth + 1, index);
      }
    };

    walk(tree.root, 0, undefined);

    const sized = rows.map((row) => {
      const word =
        row.node.state === undefined
          ? undefined
          : SpecSections.stateWord({ chrome, state: row.node.state });
      const hasSub = row.node.sublabel !== undefined;
      const icon = row.node.state === undefined ? 0 : 26;
      const wordWidth = word === undefined ? 0 : Math.ceil(word.length * 7.4) + 20;
      const textWidth = Math.max(
        Math.ceil(row.node.label.length * KindFigureConstants.LABEL_PX) + wordWidth,
        Math.ceil((row.node.sublabel?.length ?? 0) * KindFigureConstants.SMALL_PX),
      );
      const boxWidth = Math.max(160, textWidth + 28 + icon);

      return { ...row, word, hasSub, icon, boxWidth, boxHeight: hasSub ? 50 : 36 };
    });
    let cursor = TREE_TOP;
    const placed = sized.map((row) => {
      const placement = { ...row, x: KindFigureConstants.MARGIN + row.depth * INDENT, y: cursor };

      cursor += row.boxHeight + ROW_GAP;

      return placement;
    });
    const width = Math.max(
      KindFigureConstants.MIN_WIDTH,
      Math.max(...placed.map((row) => row.x + row.boxWidth)) + KindFigureConstants.MARGIN,
    );
    const height = cursor - ROW_GAP + TREE_TOP;
    const guides = placed
      .map((row, index) => {
        const children = placed.filter((other) => other.parent === index);

        if (children.length === 0) {
          return '';
        }

        const trunk = row.x + 14;
        const lastCentre = Math.max(...children.map((child) => child.y + child.boxHeight / 2));

        return `<path class="kguide" d="M${trunk} ${row.y + row.boxHeight}V${lastCentre}${children.map((child) => `M${trunk} ${child.y + child.boxHeight / 2}H${child.x}`).join('')}"/>`;
      })
      .join('');
    const boxes = placed
      .map((row) => {
        const centre = row.y + row.boxHeight / 2;
        const textX = row.x + 14 + row.icon;
        const state = row.node.state;

        return `<g class="knode${state === undefined ? '' : ` kn-${state.replaceAll(' ', '-')}`}"><rect class="kbox" x="${row.x}" y="${row.y}" width="${row.boxWidth}" height="${row.boxHeight}" rx="4"/>${state === undefined ? '' : `<g class="kic" transform="translate(${row.x + 12} ${centre - 8})">${SpecCharts.stateIcon({ state, size: 16 }).replace('<svg', '<svg x="0" y="0"')}</g>`}<text class="kt" x="${textX}" y="${row.hasSub ? row.y + 21 : centre + 5}">${FigureLayout.escapeText({ value: row.node.label })}</text>${row.word === undefined ? '' : `<text class="kw" x="${row.x + row.boxWidth - 12}" y="${row.hasSub ? row.y + 21 : centre + 4}" text-anchor="end">${FigureLayout.escapeText({ value: row.word })}</text>`}${row.node.sublabel === undefined ? '' : `<text class="ks" x="${textX}" y="${row.y + 39}">${FigureLayout.escapeText({ value: row.node.sublabel })}</text>`}</g>`;
      })
      .join('');
    const outline = (node: ITreeNode): string => {
      const state =
        node.state === undefined ? '' : ` ${SpecSections.chip({ chrome, state: node.state })}`;
      const inner =
        node.children === undefined || node.children.length === 0
          ? ''
          : `<ul class="kt-in">${node.children.map(outline).join('')}</ul>`;

      return `<li><b>${FigureLayout.escapeText({ value: node.label })}</b>${node.sublabel === undefined ? '' : ` <span class="mut">${FigureLayout.escapeText({ value: node.sublabel })}</span>`}${state}${inner}</li>`;
    };
    const label = `${chrome.tree}: ${tree.root.label}`;

    return {
      svg: KindFigureUtility.svgOf({ width, height, label, body: `${guides}${boxes}` }),
      width,
      list: `<ul class="path kl ktr">${outline(tree.root)}</ul>`,
      caption:
        tree.caption ??
        `${tree.root.label}: ${rows.length} ${KindFigureUtility.wordOf({ chrome, key: 'countItems' })}`,
      label,
    };
  }
}
