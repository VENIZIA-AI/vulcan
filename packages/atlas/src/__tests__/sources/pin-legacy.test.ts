import { afterAll, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { toAtlasProject } from '@/common/project-config';
import type { IReleaseTable } from '@/releases/common';
import { decidePin } from '@/sources/pin';
import { install, makeTempDirectory, TEMP_DIRECTORIES } from './source-repo.helper';

afterAll(() => {
  for (const directory of TEMP_DIRECTORIES) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** A root with `@a/kernel` installed at `version`. */
const installed = (opts: { version: string }): string => {
  const root = makeTempDirectory({ prefix: 'atlas-pin-legacy-' });

  install({ root, name: '@a/kernel', version: opts.version });

  return root;
};

const project = (opts: { root: string }) =>
  toAtlasProject({
    root: opts.root,
    manifest: {
      schemaVersion: 1,
      packages: [{ name: '@a/kernel', dir: 'kernel', aliases: [], retired: false }],
      release: { tagPattern: 'vulcan-v<version>', legacyTagPatterns: ['v<version>'] },
    },
  });

/** 0.4.7 was read through the legacy template (it carries its tag); 0.4.8 through the current one. */
const TABLE: IReleaseTable = {
  releases: {
    kernel: [
      { version: '0.4.8', date: '2026-10-30', sha: 'bbbbbbb', order: 1 },
      { version: '0.4.7', date: '2026-10-28', sha: 'aaaaaaa', order: 0, tag: 'v0.4.7' },
    ],
  },
  changelogs: [],
};

describe('decidePin across a tag rename', () => {
  test('an installed release of the old layout pins the tag it was read from, not one rebuilt from the template', () => {
    const root = installed({ version: '0.4.7' });
    const decision = decidePin({ roots: [root], project: project({ root }), table: TABLE });

    expect(decision).toMatchObject({ pinned: true, tag: 'v0.4.7' });
  });

  test('an installed release of the new layout pins the tag the current template names', () => {
    const root = installed({ version: '0.4.8' });
    const decision = decidePin({ roots: [root], project: project({ root }), table: TABLE });

    expect(decision).toMatchObject({ pinned: true, tag: 'vulcan-v0.4.8' });
  });
});
