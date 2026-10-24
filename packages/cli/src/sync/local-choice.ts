import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { LOCAL_AGENTS_FILE, renderLocalChoice } from '../agents/index.ts';
import { SyncStatuses } from './common/index.ts';
import type { ISyncAction } from './common/index.ts';

const NO_CHANGE = (): void => {};

/** The developer's stored agents: written when the machine just chose, reported unchanged when it was read. */
export const planLocalChoice = (opts: { root: string; agents: string[] }): ISyncAction => {
  const path = join(opts.root, LOCAL_AGENTS_FILE);
  const text = renderLocalChoice({ agents: opts.agents });
  const before = existsSync(path) ? readFileSync(path, 'utf8') : undefined;

  if (before === text) {
    return { path, status: SyncStatuses.UNCHANGED, apply: NO_CHANGE };
  }

  return {
    path,
    status: before === undefined ? SyncStatuses.CREATED : SyncStatuses.REPLACED,
    apply: () => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    },
  };
};

/** The one line sync adds to a committed `.gitignore`; a project without one is left alone. */
export const planLocalIgnore = (opts: { root: string }): ISyncAction[] => {
  const path = join(opts.root, '.gitignore');

  if (!existsSync(path)) {
    return [];
  }

  const text = readFileSync(path, 'utf8');

  if (text.split('\n').some((line) => line.trim() === LOCAL_AGENTS_FILE)) {
    return [];
  }

  return [
    {
      path,
      status: SyncStatuses.REPLACED,
      note: `added ${LOCAL_AGENTS_FILE}`,
      apply: () =>
        writeFileSync(
          path,
          `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}${LOCAL_AGENTS_FILE}\n`,
        ),
    },
  ];
};
