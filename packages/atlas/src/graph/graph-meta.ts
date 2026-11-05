import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { GraphFiles } from './common/constants';
import type { IGraphMeta } from './common/types';

/** `meta.json`: the time, the commit and the decision of the last build. Written last, so it never claims more than was written. */
export class GraphMeta {
  static readonly SCHEMA_VERSION = 1;

  static read(opts: { root: string }): IGraphMeta | undefined {
    const file = join(opts.root, GraphFiles.DIRECTORY, GraphFiles.META);

    if (!existsSync(file)) {
      return undefined;
    }

    try {
      const parsed: IGraphMeta = JSON.parse(readFileSync(file, 'utf8'));

      return parsed.schemaVersion === GraphMeta.SCHEMA_VERSION ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  static write(opts: { root: string; meta: IGraphMeta }): void {
    const file = join(opts.root, GraphFiles.DIRECTORY, GraphFiles.META);
    const temporary = `${file}.${process.pid}.tmp`;

    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(temporary, `${JSON.stringify(opts.meta, null, 2)}\n`);
    renameSync(temporary, file);
  }
}
