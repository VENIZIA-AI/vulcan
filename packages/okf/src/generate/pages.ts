import { relative, resolve, sep } from 'node:path';
import type { IRenderedFile } from './define.ts';
import type { ILoadedRenderer } from './registry.ts';

/** One page a renderer owns, rendered in memory: `path` is absolute, inside the bundle. */
export interface IRenderedPage {
  id: string;
  path: string;
  content: string;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Every page of every renderer, rendered before anything is written: a renderer that throws, a path
 * outside the bundle, or two pages (of two renderers, or of one) on one path stop the run with an
 * `okf:` error naming the renderer - never a partial write. `gen` writes these pages; `check`
 * compares them.
 */
export const renderPages = (opts: { renderers: ILoadedRenderer[] }): IRenderedPage[] => {
  const pages: IRenderedPage[] = [];

  for (const { renderer, context } of opts.renderers) {
    if (renderer.render === undefined) {
      continue;
    }

    let rendered: IRenderedFile | IRenderedFile[];

    try {
      rendered = renderer.render({ context, facts: renderer.collect({ context }) });
    } catch (error) {
      throw new Error(`okf: renderer '${renderer.id}' failed: ${messageOf(error)}`, {
        cause: error,
      });
    }

    for (const file of Array.isArray(rendered) ? rendered : [rendered]) {
      const path = resolve(context.bundle, file.path);

      if (!path.startsWith(`${resolve(context.bundle)}${sep}`)) {
        throw new Error(`okf: renderer '${renderer.id}' writes ${file.path}, outside the bundle`);
      }

      const owner = pages.find((page) => page.path === path);

      if (owner !== undefined) {
        throw new Error(
          `okf: renderers '${owner.id}' and '${renderer.id}' both write ${relative(resolve(context.bundle), path)}`,
        );
      }

      pages.push({ id: renderer.id, path, content: file.content });
    }
  }

  return pages;
};
