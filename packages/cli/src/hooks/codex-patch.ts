import { isAbsolute, resolve } from 'node:path';
import type { TConstValue } from '../common/index.ts';

/** What one file of an `apply_patch` is to the guards: a file it adds is written, one it changes, deletes or moves is edited. */
export class PatchedTools {
  static readonly WRITE = 'write';
  static readonly EDIT = 'edit';

  static readonly SCHEME_SET = new Set<string>([this.WRITE, this.EDIT]);

  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

export type TPatchedTool = TConstValue<typeof PatchedTools>;

export interface IPatchedFile {
  path: string;
  tool: TPatchedTool;
}

const HEADER = /^\*\*\* (Add|Update|Delete) File: (.+)$/;
const MOVE = /^\*\*\* Move to: (.+)$/;

/**
 * The files an `apply_patch` touches, from the patch text Codex sends as `tool_input.command`: the
 * `*** Add File:`, `*** Update File:`, `*** Delete File:` and `*** Move to:` lines, made absolute against `cwd`.
 */
export const patchedFilesOf = (opts: { patch: string; cwd: string }): IPatchedFile[] =>
  opts.patch.split('\n').flatMap((line): IPatchedFile[] => {
    const header = HEADER.exec(line);
    const target = header?.[2] ?? MOVE.exec(line)?.[1];

    if (target === undefined) {
      return [];
    }

    const path = target.trim();

    return [
      {
        path: isAbsolute(path) ? path : resolve(opts.cwd, path),
        tool: header?.[1] === 'Add' ? PatchedTools.WRITE : PatchedTools.EDIT,
      },
    ];
  });
