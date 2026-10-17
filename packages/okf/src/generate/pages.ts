import { relative, resolve, sep } from 'node:path';
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
 * Every renderer's page, rendered before anything is written: a renderer that throws, a path outside
 * the bundle, or two renderers on one path stop the run with an `okf:` error naming the renderer -
 * never a partial write. `gen` writes these pages; `check` compares them.
 */
export const renderPages = (opts: { renderers: ILoadedRenderer[] }): IRenderedPage[] => {
  const pages: IRenderedPage[] = [];

  for (const { renderer, context } of opts.renderers) {
    if (renderer.render === undefined) {
      continue;
    }

    let rendered: { path: string; content: string };

    try {
      rendered = renderer.render({ context, facts: renderer.collect({ context }) });
    } catch (error) {
      throw new Error(`okf: renderer '${renderer.id}' failed: ${messageOf(error)}`, {
        cause: error,
      });
    }

    const path = resolve(context.bundle, rendered.path);

    if (!path.startsWith(`${resolve(context.bundle)}${sep}`)) {
      throw new Error(`okf: renderer '${renderer.id}' writes ${rendered.path}, outside the bundle`);
    }

    const owner = pages.find(page => page.path === path);

    if (owner !== undefined) {
      throw new Error(
        `okf: renderers '${owner.id}' and '${renderer.id}' both write ${relative(resolve(context.bundle), path)}`,
      );
    }

    pages.push({ id: renderer.id, path, content: rendered.content });
  }

  return pages;
};
