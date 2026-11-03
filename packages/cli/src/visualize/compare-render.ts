import { EdgeSides } from './compare-schema.ts';
import type { TCompare } from './compare-schema.ts';
import type { TChrome } from './constants.ts';
import type { IDrawing } from './diagrams.ts';
import { FigureLayout } from './layout.ts';
import { SpecSections } from './sections.ts';
import type { ISectionContext } from './sections.ts';
import { SourceRefs } from './sources.ts';

const escaped = (value: string): string => FigureLayout.escapeText({ value });

/** The two sides of an arrow that is not in both. */
const ADDED = 'added';
const REMOVED = 'removed';

type TCompareEdge = TCompare['edges'][number];

/** The compare view: two versions of one mechanism as one figure, the arrows that differ drawn and worded apart. */
export class CompareView {
  /** The side an edge belongs to; absent means both. */
  private static sideOf(opts: { edge: TCompareEdge }): string {
    return opts.edge.in ?? EdgeSides.BOTH;
  }

  /** The class an arrow is drawn with: heavy for what only the second has, dotted for what only the first has. */
  private static variantOf(opts: { edge: TCompareEdge }): string | undefined {
    const side = CompareView.sideOf(opts);

    return side === EdgeSides.B ? ADDED : side === EdgeSides.A ? REMOVED : undefined;
  }

  /** The words that tell a changed arrow from a shared one: a sign and who has it alone. Never colour alone. */
  private static wordOf(opts: { compare: TCompare; chrome: TChrome; side: string }): string {
    const { compare, chrome, side } = opts;

    return side === EdgeSides.B
      ? `+ ${chrome.onlyHere} ${compare.b}`
      : `- ${chrome.onlyHere} ${compare.a}`;
  }

  /** A short line of an arrow in the figure: the sign and the verb, so the line style is never the only sign. */
  private static signedLabel(opts: { edge: TCompareEdge }): string {
    const variant = CompareView.variantOf(opts);

    return variant === ADDED
      ? `+ ${opts.edge.label}`
      : variant === REMOVED
        ? `- ${opts.edge.label}`
        : opts.edge.label;
  }

  /** A line sample of one kind of arrow, drawn by the same rules as the arrows of the figure. */
  private static swatch(opts: { variant: string }): string {
    return `<svg class="lg" viewBox="0 0 44 12" aria-hidden="true"><g class="edge ${opts.variant}"><path d="M0 6H44"/></g></svg>`;
  }

  /** The figure: the flow's own grid drawing with the added and removed arrows as their own classes. */
  private static svgOf(opts: { compare: TCompare; chrome: TChrome }): string {
    const { compare, chrome } = opts;
    const svg = FigureLayout.render({
      flow: {
        nodes: compare.nodes,
        edges: compare.edges.map((edge) => ({
          from: edge.from,
          to: edge.to,
          label: CompareView.signedLabel({ edge }),
          ...(CompareView.variantOf({ edge }) === undefined
            ? {}
            : { variant: CompareView.variantOf({ edge }) }),
        })),
        steps: [],
      },
    });
    // A function as the replacement: a string would read `$&`, `$'` and `` $` `` in the spec's text as patterns.
    let named = svg.replace(
      'aria-label="flow"',
      () => `aria-label="${escaped(chrome.compareView)}"`,
    );

    // A changed arrow says its words when it is hovered or read by a screen reader, with the verb after them.
    for (const edge of compare.edges) {
      const side = CompareView.sideOf({ edge });

      if (side !== EdgeSides.BOTH) {
        const name = escaped(`${edge.from}>${edge.to}`);
        const word = escaped(`${CompareView.wordOf({ compare, chrome, side })}: ${edge.label}`);

        named = named.replace(
          `data-edge="${name}"><title>${escaped(CompareView.signedLabel({ edge }))}</title>`,
          () => `data-edge="${name}"><title>${word}</title>`,
        );
      }
    }

    // The label of an arrow that runs straight down or up sits on the line, and a heavy line would run through it: beside it.
    named = named.replace(
      /(<path d="M(-?[\d.]+) -?[\d.]+L\2 -?[\d.]+"[^>]*\/><text x=")-?[\d.]+(" y="-?[\d.]+" )text-anchor="middle"/g,
      (_match, before: string, x: string, after: string) =>
        `${before}${Number(x) + 10}${after}text-anchor="start"`,
    );

    // The page script highlights and describes the flow's boxes by these names: the compare view is its own thing.
    return named
      .replaceAll(' data-node="', ' data-cn="')
      .replaceAll(' data-edge="', ' data-ce="')
      .replace(/ data-detail="[^"]*"/g, '');
  }

  /** What replaces the figure on a phone: the arrows in three groups, then the boxes that have more to say. */
  private static listOf(opts: { compare: TCompare; chrome: TChrome }): string {
    const { compare, chrome } = opts;
    const names = new Map(compare.nodes.map((node) => [node.id, node.label]));
    const nameOf = (id: string): string => escaped(names.get(id) ?? id);
    const groups: { side: string; head: string; cls: string }[] = [
      { side: EdgeSides.BOTH, head: chrome.inBoth, cls: 'same' },
      {
        side: EdgeSides.B,
        head: CompareView.wordOf({ compare, chrome, side: EdgeSides.B }),
        cls: ADDED,
      },
      {
        side: EdgeSides.A,
        head: CompareView.wordOf({ compare, chrome, side: EdgeSides.A }),
        cls: REMOVED,
      },
    ];
    const lists = groups
      .map((group) => {
        const edges = compare.edges.filter((edge) => CompareView.sideOf({ edge }) === group.side);

        return edges.length === 0
          ? ''
          : `<p class="cg ${group.cls}">${escaped(group.head)}</p><ol>${edges
              .map(
                (edge) =>
                  `<li><b>${nameOf(edge.from)}</b><span class="verb ${group.cls}">${escaped(edge.label)}</span><b>${nameOf(edge.to)}</b></li>`,
              )
              .join('')}</ol>`;
      })
      .join('');
    const details = compare.nodes
      .filter((node) => node.sublabel !== undefined || node.source !== undefined)
      .map(
        (node) =>
          `<li><b>${escaped(node.label)}</b>${node.sublabel === undefined ? '' : escaped(node.sublabel)}${node.source === undefined ? '' : SourceRefs.html({ source: node.source })}</li>`,
      )
      .join('');

    return `<div class="path cmp">${lists}</div>${details === '' ? '' : `<ul class="path-detail">${details}</ul>`}`;
  }

  /** The drawing, the width it needs, and what stands in for it: a key on wide screens, the grouped list on a phone. */
  static drawing(opts: { compare: TCompare; chrome: TChrome }): IDrawing {
    const { compare, chrome } = opts;
    const key = [
      { variant: 'main', word: chrome.inBoth },
      { variant: ADDED, word: CompareView.wordOf({ compare, chrome, side: EdgeSides.B }) },
      { variant: REMOVED, word: CompareView.wordOf({ compare, chrome, side: EdgeSides.A }) },
    ]
      .map(
        (item) =>
          `<li>${CompareView.swatch({ variant: item.variant })}<span>${escaped(item.word)}</span></li>`,
      )
      .join('');

    return {
      svg: CompareView.svgOf(opts),
      width: FigureLayout.figureWidth({
        cols: Math.max(...compare.nodes.map((node) => node.col)) + 1,
      }),
      fallback: `<ul class="legend cmp-key">${key}</ul>${CompareView.listOf(opts)}`,
    };
  }

  /** The `compare` part of the page, after the flow and the architecture. */
  static section(opts: { ctx: ISectionContext }): string {
    const { compare } = opts.ctx.spec;
    const { chrome } = opts.ctx;

    if (compare === undefined) {
      return '';
    }

    const count = (side: string): number =>
      compare.edges.filter((edge) => CompareView.sideOf({ edge }) === side).length;
    const caption =
      compare.caption ??
      `${CompareView.wordOf({ compare, chrome, side: EdgeSides.B })} (${count(EdgeSides.B)}), ${CompareView.wordOf({ compare, chrome, side: EdgeSides.A })} (${count(EdgeSides.A)})`;

    return SpecSections.section({
      id: 'compare',
      title: chrome.compareView,
      body: `<figure class="kfig">${SpecSections.figure({ ctx: opts.ctx, drawing: CompareView.drawing({ compare, chrome }) })}<figcaption>${escaped(caption)}</figcaption></figure>`,
    });
  }
}
