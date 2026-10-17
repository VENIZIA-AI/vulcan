import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { replaceRegion } from './regions.ts';
import { REGIONS, RENDERERS } from './renderers.ts';
import { repoRelative } from '../source/index.ts';

export const gen = (): void => {
  for (const region of REGIONS) {
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

  for (const renderer of RENDERERS) {
    const { path, content } = renderer.render();

    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
    console.log(`gen: wrote ${repoRelative({ path })}`);
  }
};
