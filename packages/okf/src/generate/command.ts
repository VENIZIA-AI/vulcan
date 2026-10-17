import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { replaceRegion } from './regions.ts';
import { writeContents } from './contents-files.ts';
import { loadGeneration } from './registry.ts';
import { repoRelative } from '../source/index.ts';

/** Writes exactly the configured regions and renderers, regions first. */
export const gen = async (): Promise<void> => {
  const { renderers, regions } = await loadGeneration();
  // Every project's long agent-read files carry a contents list, whatever it renders.
  const contents = writeContents();

  for (const file of contents) {
    console.log(`gen: wrote the contents list of ${file}`);
  }

  if (renderers.length === 0 && regions.length === 0) {
    if (contents.length === 0) {
      console.log('gen: nothing configured - okf.renderers and okf.regions are empty');
    }

    return;
  }

  for (const region of regions) {
    if (!existsSync(region.file)) {
      console.warn(
        `gen: skipped region '${region.id}' - ${repoRelative({ path: region.file })} does not exist yet`,
      );
      continue;
    }

    const next = replaceRegion({
      text: readFileSync(region.file, 'utf8'),
      id: region.id,
      body: region.render(),
    });

    writeFileSync(region.file, next);
    console.log(`gen: wrote region '${region.id}' (${repoRelative({ path: region.file })})`);
  }

  for (const { renderer, context } of renderers) {
    if (renderer.render === undefined) {
      continue;
    }

    const rendered = renderer.render({ context, facts: renderer.collect({ context }) });
    const path = join(context.bundle, rendered.path);

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, rendered.content);
    console.log(`gen: wrote ${repoRelative({ path })}`);
  }
};
