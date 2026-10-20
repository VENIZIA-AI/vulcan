/** The OKF v0.2 conformance layer: pure, never throws - the part of okf other tools build on. */
export * from './spec/index.ts';

/** The renderer API a project module builds on (`okf.renderers[].module`). */
export { defineRenderer } from './generate/define.ts';
export type {
  IRenderContext,
  IRenderedFile,
  IRenderer,
  IRenderPage,
  IRenderSource,
} from './generate/define.ts';
