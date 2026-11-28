/** The OKF v0.2 conformance layer: pure, never throws - the part of okf other tools build on. */
export * from './spec/index.ts';

export { ContentsList } from './generate/contents.ts';

/** The error and the small types every VULCAN package shares. */
export { VulcanError } from './common/error.ts';
export { LogLevels, StderrLogger } from './common/stderr-logger.ts';
export type { ILogger, TLogLevel } from './common/stderr-logger.ts';
export { ConstClass } from './common/types.ts';
export type { TConstValue, TNullable } from './common/types.ts';

/** The renderer API a project module builds on (`okf.renderers[].module`). */
export { defineRenderer } from './generate/define.ts';
export type {
  IRenderContext,
  IRenderedFile,
  IRenderer,
  IRenderPage,
  IRenderSource,
} from './generate/define.ts';
