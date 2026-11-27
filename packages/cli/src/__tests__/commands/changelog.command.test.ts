import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { ToolRunner } from '../../commands/x.command.ts';
import { VulcanTools } from '../../common/index.ts';
import { createProject, removeProjects } from '../helpers/project.helper.ts';
import { runCli } from '../helpers/run.helper.ts';

afterAll(removeProjects);

const atlasBin = ToolRunner.resolveBin({ name: VulcanTools.ATLAS });
const BREAKING_ENTRY = `---
title: Removes a helper
packages: ['@a/kernel']
---

# Changelog - 2026-11-20

<Badge type="warning" text="Breaking Change" />
`;
const CONFIG = `export default { project: { packages: [{ dir: 'kernel', name: '@a/kernel' }] }, knowledge: { bundle: '.agents/knowledge', changelogs: 'changes', migrationFrom: '2026-11-13' } };
`;

const projectWith = (opts: { entry: string }): string =>
  createProject({
    files: {
      '.configs/vulcan.config.mts': CONFIG,
      '.agents/knowledge/index.md': '# Probe\n',
      'changes/2026-11-20-a.md': opts.entry,
    },
  });

describe('vulcan check changelog', () => {
  test.skipIf(atlasBin === undefined || !existsSync(atlasBin))(
    'C1: exits 1 and names the entry that owes a migration block',
    () => {
      const result = runCli({
        args: ['check', 'changelog'],
        cwd: projectWith({ entry: BREAKING_ENTRY }),
      });

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('2026-11-20-a.md');
      expect(result.stdout).toBe('');
    },
  );

  test.skipIf(atlasBin === undefined || !existsSync(atlasBin))(
    'exits 0 when the entry carries a conforming block',
    () => {
      const entry = BREAKING_ENTRY.replace(
        '---\n\n#',
        `migration:
  - id: remove-helper
    symbols: [Helper.make]
    upgrade: { steps: ["Use HelperFactory.build()"] }
    downgrade: { steps: ["Use Helper.make()"] }
---

#`,
      );
      const result = runCli({ args: ['check', 'changelog'], cwd: projectWith({ entry }) });

      expect(result.code).toBe(0);
    },
  );

  test('an unknown subcommand exits 2 with the usage; none exits 2 too', () => {
    const root = projectWith({ entry: BREAKING_ENTRY });

    expect(runCli({ args: ['changelog', 'nope'], cwd: root }).code).toBe(2);
    expect(runCli({ args: ['changelog'], cwd: root }).code).toBe(2);
  });
});

describe('vulcan migrate notes', () => {
  const folderProject = (): string =>
    createProject({
      files: {
        '.configs/vulcan.config.mts': CONFIG.replace(
          "migrationFrom: '2026-11-13'",
          "migrationFrom: '0.4.5'",
        ),
        '.agents/knowledge/index.md': '# Probe\n',
        'changes/0.4.8/log.md':
          "---\ntitle: 0.4.8\nversion: 0.4.8\npackages: ['@a/kernel']\n---\nThe 0.4.8 line.\n",
        'changes/0.4.8/migration.yaml': '{}\n',
      },
    });

  test.skipIf(atlasBin === undefined || !existsSync(atlasBin))(
    'prints the notes of a version folder, and nothing for --migration when there is no block',
    () => {
      const root = folderProject();
      const notes = runCli({ args: ['migrate', 'notes', '--version', '0.4.8'], cwd: root });
      const migration = runCli({
        args: ['migrate', 'notes', '--version', '0.4.8', '--migration'],
        cwd: root,
      });

      expect(notes.code).toBe(0);
      expect(notes.stdout).toContain('The 0.4.8 line.');
      expect(notes.stdout).toContain('[@a/kernel@0.4.8]');
      expect(migration.code).toBe(0);
      expect(migration.stdout).toBe('');
    },
  );

  test('a request that is not --version <X.Y.Z> [--migration] exits 2 with the usage', () => {
    const root = folderProject();

    expect(runCli({ args: ['migrate', 'notes'], cwd: root }).code).toBe(2);
    expect(runCli({ args: ['migrate', 'notes', '--version'], cwd: root }).code).toBe(2);
    expect(
      runCli({ args: ['migrate', 'notes', '--version', '0.4.8', '--all'], cwd: root }).code,
    ).toBe(2);
  });
});
