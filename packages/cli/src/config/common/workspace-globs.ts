import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JsonValue } from '../../common/json.ts';
import { FallbackUtility } from '../../common/utilities/fallback.utility.ts';

/** The workspace globs of a root `package.json`, from either form: the one reader of them, for `init`, `add`, the scaffold check and the derived `packages`. */
export class WorkspaceGlobs {
  /** The globs as written, negations (`!pattern`) included, in order; empty when the file is missing, unreadable or has none. Never throws. */
  static read(opts: { root: string }): string[] {
    return FallbackUtility.of({
      read: () => {
        const file: unknown = JSON.parse(readFileSync(join(opts.root, 'package.json'), 'utf8'));
        const workspaces = JsonValue.readProperty({ value: file, key: 'workspaces' });
        const list = Array.isArray(workspaces)
          ? workspaces
          : JsonValue.readProperty({ value: workspaces, key: 'packages' });

        return Array.isArray(list)
          ? list.filter((glob: unknown): glob is string => typeof glob === 'string')
          : [];
      },
      otherwise: [],
    });
  }
}
