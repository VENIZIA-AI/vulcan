import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readOkfProject } from '../project/index.ts';
import type { IOkfRendererEntry } from '../project/index.ts';
import { CONTENTS_ID } from './contents.ts';
import { createRenderContext } from './define.ts';
import type { IRenderContext, IRenderer } from './define.ts';
import { BUILT_IN_RENDERERS } from './renderers.ts';

export interface ILoadedRenderer {
  renderer: IRenderer;
  context: IRenderContext;
}

/** One `okf.regions` entry, resolved: `file` is absolute, `render` gives the region's body. */
export interface ILoadedRegion {
  id: string;
  file: string;
  render: () => string;
}

const isRenderer = (opts: { value: unknown }): opts is { value: IRenderer } => {
  const { value } = opts;

  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'collect' in value &&
    typeof value.collect === 'function'
  );
};

const builtInRenderer = (opts: { id: string }): IRenderer => {
  const renderer = BUILT_IN_RENDERERS[opts.id];

  if (renderer === undefined) {
    throw new Error(
      `okf: '${opts.id}' is not a built-in renderer (${Object.keys(BUILT_IN_RENDERERS).join(', ')}) - give it a module`,
    );
  }

  return renderer;
};

/** A project module: a file under the root whose default export is `defineRenderer({ ... })`. */
const moduleRenderer = async (opts: {
  root: string;
  id: string;
  module: string;
}): Promise<IRenderer> => {
  const file = join(opts.root, opts.module);

  if (!existsSync(file)) {
    throw new Error(`okf: renderer module ${opts.module} not found`);
  }

  const imported: { default?: unknown } = await import(file);
  const exported = { value: imported.default };

  if (!isRenderer(exported)) {
    throw new Error(
      `okf: renderer module ${opts.module} must default-export defineRenderer({ ... })`,
    );
  }

  if (exported.value.id !== opts.id) {
    throw new Error(
      `okf: renderer module ${opts.module} defines '${exported.value.id}', the config names '${opts.id}'`,
    );
  }

  return exported.value;
};

const loadRenderer = async (opts: {
  root: string;
  entry: IOkfRendererEntry;
}): Promise<ILoadedRenderer> => {
  const { entry } = opts;

  // Allowed - a project may own a built-in's output - but never silent.
  if (entry.module !== undefined && Object.hasOwn(BUILT_IN_RENDERERS, entry.id)) {
    console.warn(`okf: module '${entry.id}' replaces the built-in renderer`);
  }

  const pending =
    entry.module === undefined
      ? builtInRenderer({ id: entry.id })
      : moduleRenderer({ root: opts.root, id: entry.id, module: entry.module });
  const renderer = await pending;

  return { renderer, context: createRenderContext({ options: entry.options }) };
};

/**
 * Exactly what the project configured: `okf.renderers` in order, and `okf.regions`, each region's
 * renderer taken from the loaded ones, else from the built-ins. Nothing runs that is not listed.
 */
export const loadGeneration = async (): Promise<{
  renderers: ILoadedRenderer[];
  regions: ILoadedRegion[];
}> => {
  const project = readOkfProject();
  const renderers: ILoadedRenderer[] = [];

  for (const entry of project.renderers) {
    if (renderers.some((loaded) => loaded.renderer.id === entry.id)) {
      throw new Error(`okf: two renderers with id '${entry.id}'`);
    }

    const renderer = await loadRenderer({ root: project.root, entry });

    renderers.push(renderer);
  }

  const regions = project.regions.map((region) => {
    if (region.id === CONTENTS_ID) {
      throw new Error(
        `okf: region id '${CONTENTS_ID}' is reserved for the contents list okf writes - rename the region`,
      );
    }

    const loaded = renderers.find((candidate) => candidate.renderer.id === region.renderer) ?? {
      renderer: builtInRenderer({ id: region.renderer }),
      context: createRenderContext({ options: {} }),
    };
    const { renderer, context } = loaded;

    if (renderer.region === undefined) {
      throw new Error(
        `okf: region '${region.id}' names renderer '${region.renderer}', which renders no region`,
      );
    }

    const renderRegion = renderer.region.bind(renderer);

    return {
      id: region.id,
      file: region.file,
      render: () => renderRegion({ context, facts: renderer.collect({ context }) }),
    };
  });

  return { renderers, regions };
};
