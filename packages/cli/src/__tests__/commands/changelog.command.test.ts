import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { ToolRunner } from '../../commands/x.command.ts';
import { VulcanTools } from '../../common/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const atlasBin = ToolRunner.resolveBin({ name: VulcanTools.ATLAS });
const BREAKING_ENTRY = `---
title: Removes a helper
packages: ['@a/kernel']
---

# Changelog - 2026-11-20

<Badge type="warning" text="Breaking Change" />
`;
const CONFIG = `export default {
  packages: [{ dir: 'kernel', name: '@a/kernel' }],
  knowledge: { bundle: '.agents/knowledge', changelogs: 'changes', migrationFrom: '2026-11-13' },
};
`;

const projectWith = (opts: { entry: string }): string =>
  createProject({
    files: {
      '.configs/vulcan.config.mts': CONFIG,
      '.agents/knowledge/index.md': '# Probe\n',
      'changes/2026-11-20-a.md': opts.entry,
    },
  });

describe('vulcan changelog check', () => {
  test.skipIf(atlasBin === undefined || !existsSync(atlasBin))(
    'C1: exits 1 and names the entry that owes a migration block',
    () => {
      const result = runCli({
        args: ['changelog', 'check'],
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
      const result = runCli({ args: ['changelog', 'check'], cwd: projectWith({ entry }) });

      expect(result.code).toBe(0);
    },
  );

  test('an unknown subcommand exits 2 with the usage; none exits 2 too', () => {
    const root = projectWith({ entry: BREAKING_ENTRY });

    expect(runCli({ args: ['changelog', 'nope'], cwd: root }).code).toBe(2);
    expect(runCli({ args: ['changelog'], cwd: root }).code).toBe(2);
  });
});
