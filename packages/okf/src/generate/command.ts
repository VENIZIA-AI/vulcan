import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { ManagedRegion } from './regions.ts';
import { ContentsFiles } from './contents-files.ts';
import { GeneratedPages } from './pages.ts';
import { GenerationRegistry } from './registry.ts';
import { BUILT_IN_RENDERERS } from './renderers.ts';
import { SourceScanner } from '../source/index.ts';

/** The file as it is on disk, or undefined when it does not exist yet. */
const currentOf = (opts: { path: string }): string | undefined =>
  existsSync(opts.path) ? readFileSync(opts.path, 'utf8') : undefined;

/**
 * Writes exactly the configured regions and renderers, then the contents lists. Everything renders in
 * memory first, so a failure writes nothing; the contents lists go last, so one `gen` is a fixed point
 * - they see what the regions wrote, and skip every page a renderer owns. Only a file whose content
 * changed is written and named, so a run with nothing to do says so in one line.
 */
export const gen = async (): Promise<void> => {
  const { renderers, regions } = await GenerationRegistry.load();
  const regionWrites = regions.flatMap((region) => {
    const current = currentOf({ path: region.file });

    if (current === undefined) {
      console.warn(
        `gen: skipped region '${region.id}' - ${SourceScanner.repoRelative({ path: region.file })} does not exist yet`,
      );

      return [];
    }

    const text = ManagedRegion.replace({
      text: current,
      id: region.id,
      file: SourceScanner.repoRelative({ path: region.file }),
      body: region.render(),
    });

    return text === current ? [] : [{ region, text }];
  });
  const rendered = GeneratedPages.render({ renderers });
  const pages = rendered.filter((page) => currentOf({ path: page.path }) !== page.content);

  for (const { region, text } of regionWrites) {
    writeFileSync(region.file, text);
    console.log(
      `gen: wrote region '${region.id}' (${SourceScanner.repoRelative({ path: region.file })})`,
    );
  }

  for (const page of pages) {
    mkdirSync(dirname(page.path), { recursive: true });
    writeFileSync(page.path, page.content);
    console.log(`gen: wrote ${SourceScanner.repoRelative({ path: page.path })}`);
  }

  // Every project's long agent-read files carry a contents list, whatever it renders.
  const contents = ContentsFiles.write({ skip: new Set(rendered.map((page) => page.path)) });

  for (const file of contents) {
    console.log(`gen: wrote the contents list of ${file}`);
  }

  if (renderers.length === 0 && regions.length === 0 && contents.length === 0) {
    console.log(
      `gen: nothing configured - okf.renderers and okf.regions are empty; add a renderer to okf.renderers in the vulcan config (built in: ${Object.keys(BUILT_IN_RENDERERS).join(', ')})`,
    );
  } else if (regionWrites.length === 0 && pages.length === 0 && contents.length === 0) {
    console.log('gen: up to date');
  }
};
