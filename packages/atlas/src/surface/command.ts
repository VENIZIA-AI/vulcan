import { RegenerateHint } from '@/common/regenerate-hint';
import { writeFileSync } from 'node:fs';
import { PublicSurface, SurfaceVerdicts } from './generator';

/** `vulcan atlas surface gen|check`: writes the public surface, or says whether the committed one is fresh. */
export class SurfaceCommand {
  static run(opts: { command?: string; outputPath?: string }): number {
    switch (opts.command) {
      case 'gen': {
        writeFileSync(PublicSurface.OUTPUT, PublicSurface.render());
        console.log(`wrote ${PublicSurface.OUTPUT}`);

        return 0;
      }

      case 'check': {
        const verdict = PublicSurface.verdict({ outputPath: opts.outputPath });

        if (verdict === SurfaceVerdicts.FRESH) {
          console.log('fresh .agents/knowledge/reference/public-surface.md');

          return 0;
        }

        if (verdict === SurfaceVerdicts.MISSING) {
          console.error(
            'not set up .agents/knowledge/reference/public-surface.md - no public surface is committed yet; ' +
              `${RegenerateHint.of({ command: 'surface' })} once to adopt it, then commit the file`,
          );

          return 1;
        }

        console.error(
          'stale .agents/knowledge/reference/public-surface.md - the public surface changed; ' +
            `${RegenerateHint.of({ command: 'surface' })} only if the change is intended`,
        );

        return 1;
      }

      default: {
        console.error('usage: vulcan atlas surface gen|check');

        return 2;
      }
    }
  }
}
