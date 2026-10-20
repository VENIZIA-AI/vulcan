/**
 * `@venizia/vulcan/okf` - the okf renderer API for a project module. A project installs
 * `@venizia/vulcan` alone; its okf is a dependency, not resolvable from the project, so the API is
 * re-exported here.
 */
export { defineRenderer } from '@venizia/vulcan-okf';
export type {
  IRenderContext,
  IRenderedFile,
  IRenderer,
  IRenderPage,
  IRenderSource,
} from '@venizia/vulcan-okf';
