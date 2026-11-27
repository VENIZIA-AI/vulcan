import type { TChrome } from '../constants.ts';
import type { TVisualizeSpec } from '../schema.ts';

/** What every section needs: the spec, the page's words, and the widths of the figures that must give way to a list on a phone. */
export interface ISectionContext {
  spec: TVisualizeSpec;
  chrome: TChrome;
  fits: Set<string>;
  /** The row spans the page uses (see `GridSpans`). */
  spans: Set<number>;
}

/** A figure, the width it needs to keep its text readable, the list that replaces it on a phone, and its sentences. */
export interface IKindDrawing {
  svg: string;
  width: number;
  list: string;
  caption: string;
  label: string;
}
