import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { replaceRegion } from './regions.ts';
import { writeContents } from './contents-files.ts';
import { renderPages } from './pages.ts';
import { loadGeneration } from './registry.ts';
import { repoRelative } from '../source/index.ts';

/**
 * Writes exactly the configured regions and renderers, then the contents lists. Everything renders in
 * memory first, so a failure writes nothing; the contents lists go last, so one `gen` is a fixed point
 * - they see what the regions wrote, and skip every page a renderer owns.
 */
export const gen = async (): Promise<void> => {
  const { renderers, regions } = await loadGeneration();
  const regionWrites = regions.flatMap(region => {
    if (!existsSync(region.file)) {
      console.warn(
        `gen: skipped region '${region.id}' - ${repoRelative({ path: region.file })} does not exist yet`,
      );

      return [];
    }

    return [
      {
        region,
        text: replaceRegion({
          text: readFileSync(region.file, 'utf8'),
          id: region.id,
          body: region.render(),
        }),
      },
    ];
  });
  const pages = renderPages({ renderers });

  for (const { region, text } of regionWrites) {
    writeFileSync(region.file, text);
    console.log(`gen: wrote region '${region.id}' (${repoRelative({ path: region.file })})`);
  }

  for (const page of pages) {
    mkdirSync(dirname(page.path), { recursive: true });
    writeFileSync(page.path, page.content);
    console.log(`gen: wrote ${repoRelative({ path: page.path })}`);
  }

  // Every project's long agent-read files carry a contents list, whatever it renders.
  const contents = writeContents({ skip: new Set(pages.map(page => page.path)) });

  for (const file of contents) {
    console.log(`gen: wrote the contents list of ${file}`);
  }

  if (renderers.length === 0 && regions.length === 0 && contents.length === 0) {
    console.log('gen: nothing configured - okf.renderers and okf.regions are empty');
  }
};
