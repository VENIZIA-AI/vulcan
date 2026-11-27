import type { IKindDrawing } from './common/index.ts';
import type { TChrome } from './constants.ts';
import { FigureLayout } from './layout.ts';
import type { INewKindsSpec } from './kinds-validate.ts';
import { LifecycleBuilder } from './lifecycle-builder.ts';
import { SpecSections } from './sections.ts';
import { SequenceBuilder } from './sequence-builder.ts';
import { TreeBuilder } from './tree-builder.ts';

/** What a section of the new kinds needs: its slice of the spec, the page's words, and the figure widths to register. */
export interface INewKindsContext {
  spec: INewKindsSpec;
  chrome: TChrome;
  fits: Set<string>;
}

const escaped = (value: string): string => FigureLayout.escapeText({ value });

// -----------------------------------------------------------------------------------------------------------------
// Sections
// -----------------------------------------------------------------------------------------------------------------

/** A figure in its frame, its list as a sibling for the page to swap in on a phone, and its caption. */
const frame = (opts: { ctx: INewKindsContext; drawing: IKindDrawing }): string => {
  const width = Math.round(opts.drawing.width);

  opts.ctx.fits.add(`${width}`);

  return `<figure class="kfig"><div class="fig f${width}${width * 1.25 <= 928 ? ' at' : ''}">${opts.drawing.svg}</div>${opts.drawing.list}<figcaption>${escaped(opts.drawing.caption)}</figcaption></figure>`;
};

export class KindsRender {
  static sequenceSection(opts: { ctx: INewKindsContext }): string {
    const { sequence } = opts.ctx.spec;

    return sequence === undefined
      ? ''
      : SpecSections.section({
          id: 'sequence',
          isWide: true,
          title: opts.ctx.chrome.sequence,
          body: frame({
            ctx: opts.ctx,
            drawing: SequenceBuilder.build({ sequence, chrome: opts.ctx.chrome }),
          }),
        });
  }

  static lifecycleSection(opts: { ctx: INewKindsContext }): string {
    const { lifecycle } = opts.ctx.spec;

    return lifecycle === undefined
      ? ''
      : SpecSections.section({
          id: 'lifecycle',
          isWide: true,
          title: opts.ctx.chrome.lifecycle,
          body: frame({
            ctx: opts.ctx,
            drawing: LifecycleBuilder.build({ lifecycle, chrome: opts.ctx.chrome }),
          }),
        });
  }

  static treeSection(opts: { ctx: INewKindsContext }): string {
    const { tree } = opts.ctx.spec;

    return tree === undefined
      ? ''
      : SpecSections.section({
          id: 'tree',
          isWide: true,
          title: opts.ctx.chrome.tree,
          body: frame({
            ctx: opts.ctx,
            drawing: TreeBuilder.build({ tree, chrome: opts.ctx.chrome }),
          }),
        });
  }
}
