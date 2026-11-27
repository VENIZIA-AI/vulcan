import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JsonValue } from '../../common/json.ts';

/** The workspace globs of a root `package.json`, from either form: the one reader of them, for `init`, `add`, the scaffold check and the derived `packages`. */
export class WorkspaceGlobs {
  /** The globs as written, negations (`!pattern`) included, in order; empty when the file is missing, unreadable or has none. Never throws. */
  static read(opts: { root: string }): string[] {
    try {
      const file: unknown = JSON.parse(readFileSync(join(opts.root, 'package.json'), 'utf8'));
      const workspaces = JsonValue.readProperty({ value: file, key: 'workspaces' });
      const list = Array.isArray(workspaces)
        ? workspaces
        : JsonValue.readProperty({ value: workspaces, key: 'packages' });

      return Array.isArray(list)
        ? list.filter((glob: unknown): glob is string => typeof glob === 'string')
        : [];
      // eslint-disable-next-line venizia/no-silent-catch -- a package.json that cannot be read declares no workspaces
    } catch {
      return [];
    }
  }
}
