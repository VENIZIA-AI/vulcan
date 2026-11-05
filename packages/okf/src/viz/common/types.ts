import type { TConstValue } from '../../common/index.ts';
import type { Locales, TableCells, ThemeModes, VizViews } from './constants.ts';

export type TLocale = TConstValue<typeof Locales>;
export type TVizView = TConstValue<typeof VizViews>;
export type TThemeMode = TConstValue<typeof ThemeModes>;
export type TTableCell = TConstValue<typeof TableCells>;

/** The page's custom properties (without the `--`) and their colours, for one mode. */
export type TVizPalette = Record<string, string>;

export interface IVizNode {
  id: string;
  type: string;
  title: string;
  description: string;
  resource: string;
  tags: string[];
  body: string;
  group: string;
  degree: number;
}

export interface IVizEdge {
  source: string;
  target: string;
}

export interface IVizSection {
  key: string;
  label: string;
  count: number;
}

/** Project-specific prose, per locale - the only text the explorer does not derive from the bundle. */
export interface IVizCopy {
  heading: string;
  tagline: string;
  sectionDescriptions: Record<string, string>;
}

/** The contract between the builder (Bun) and the client (browser), embedded as JSON in the page. */
export interface IVizData {
  brand: string;
  nodes: IVizNode[];
  edges: IVizEdge[];
  sections: IVizSection[];
  copy: Record<TLocale, IVizCopy>;
  /** The colours of the page in each mode, from the project's theme tokens. */
  theme: Record<TThemeMode, TVizPalette>;
}
