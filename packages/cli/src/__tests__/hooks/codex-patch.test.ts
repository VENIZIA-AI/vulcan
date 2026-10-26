import { describe, expect, test } from 'bun:test';
import { patchedFilesOf, PatchedTools } from '../../hooks/index.ts';

const PATCH = [
  '*** Begin Patch',
  '*** Add File: docs/new.md',
  '+hello',
  '*** Update File: src/a.ts',
  '@@',
  '-old',
  '+new',
  '*** Delete File: /etc/gone.txt',
  '*** Update File: src/b.ts',
  '*** Move to: src/c.ts',
  '*** End Patch',
].join('\n');

describe('patchedFilesOf', () => {
  test('reads every header, made absolute against the cwd, an add being a write and the rest edits', () => {
    expect(patchedFilesOf({ patch: PATCH, cwd: '/work' })).toEqual([
      { path: '/work/docs/new.md', tool: PatchedTools.WRITE },
      { path: '/work/src/a.ts', tool: PatchedTools.EDIT },
      { path: '/etc/gone.txt', tool: PatchedTools.EDIT },
      { path: '/work/src/b.ts', tool: PatchedTools.EDIT },
      { path: '/work/src/c.ts', tool: PatchedTools.EDIT },
    ]);
  });

  test('a text with no header, an empty text and a body line that looks like one are not files', () => {
    expect(patchedFilesOf({ patch: 'git status', cwd: '/work' })).toEqual([]);
    expect(patchedFilesOf({ patch: '', cwd: '/work' })).toEqual([]);
    expect(patchedFilesOf({ patch: '+*** Add File: x', cwd: '/work' })).toEqual([]);
  });
});
