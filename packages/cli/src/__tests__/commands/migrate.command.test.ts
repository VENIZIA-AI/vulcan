import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ToolRunner } from '../../commands/x.command.ts';
import { VulcanTools } from '../../common/index.ts';
import { commitAll, git, initRepo } from '../git-repo.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const atlasBin = ToolRunner.resolveBin({ name: VulcanTools.ATLAS });
const built = atlasBin !== undefined && existsSync(atlasBin);

const ENTRY = `---
title: Thing.make moves to a factory
packages: ['@venizia/kernel']
migration:
  - id: thing-factory
    symbols: [Thing.make]
    upgrade: { before: "Thing.make()", after: "ThingFactory.build()" }
    downgrade: { steps: ["Call Thing.make() again"] }
---

# Changelog - 2026-02-01

<Badge type="danger" text="Breaking Change" />
`;

/** A framework repository with two tagged releases and one breaking entry between them, and an app on the first. */
const world = (): { framework: string; app: string } => {
  const framework = createProject({
    files: {
      '.configs/vulcan.config.mts': `export default {
  packages: [{ dir: 'kernel', name: '@venizia/kernel' }],
  knowledge: { bundle: '.agents/knowledge', changelogs: 'changes' },
  atlas: { tagPattern: '<dir>-v<version>' },
};
`,
      '.agents/knowledge/index.md': '# Probe\n',
    },
  });

  initRepo({ cwd: framework });
  git({ cwd: framework, args: ['tag', 'kernel-v1.0.0'] });
  mkdirSync(join(framework, 'changes'));
  writeFileSync(join(framework, 'changes', '2026-02-01-thing-factory.md'), ENTRY);
  commitAll({ cwd: framework });
  commitAll({ cwd: framework });
  git({ cwd: framework, args: ['tag', 'kernel-v1.1.0'] });

  const app = createProject({
    files: {
      'package.json': JSON.stringify({ dependencies: { '@venizia/kernel': '1.0.0' } }),
      'src/a.ts': "import { Thing } from '@venizia/kernel';\n\nThing.make();\n",
    },
  });

  return { framework, app };
};

describe('vulcan migrate', () => {
  test('a missing or other subcommand exits 2 with the usage', () => {
    const { framework } = world();

    for (const args of [['migrate'], ['migrate', 'apply']]) {
      const result = runCli({ args, cwd: framework });

      expect(result.code, args.join(' ')).toBe(2);
      expect(result.stderr, args.join(' ')).toContain('usage: vulcan migrate plan');
    }
  });

  test.skipIf(!built)(
    'plan reads the project the command runs in and prints where the app is touched',
    () => {
      const { framework, app } = world();
      const result = runCli({
        args: ['migrate', 'plan', '--package', '@venizia/kernel', '--to', 'latest', '--app', app],
        cwd: framework,
      });

      expect(result.stderr).toBe('');
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('## @venizia/kernel: 1.0.0 to 1.1.0');
      expect(result.stdout).toContain('src/a.ts:3 (Thing.make)');
      expect(result.stdout).toContain('ThingFactory.build()');
    },
  );

  test.skipIf(!built)('plan --format json is the tool answer, and a rollback reverses it', () => {
    const { framework, app } = world();
    const up = runCli({
      args: [
        'migrate',
        'plan',
        '--package',
        '@venizia/kernel',
        '--to',
        '1.1.0',
        '--format',
        'json',
        '--app',
        app,
      ],
      cwd: framework,
    });
    const down = runCli({
      args: [
        'migrate',
        'plan',
        '--package',
        '@venizia/kernel',
        '--from',
        '1.1.0',
        '--to',
        '1.0.0',
        '--app',
        app,
      ],
      cwd: framework,
    });

    expect(JSON.parse(up.stdout).plans[0].steps[0].id).toBe('thing-factory');
    expect(down.stdout).toContain('A downgrade');
    expect(down.stdout).toContain('Call Thing.make() again');
  });

  test.skipIf(!built)('an unknown version exits 1 with the message on stderr', () => {
    const { framework, app } = world();
    const result = runCli({
      args: ['migrate', 'plan', '--package', '@venizia/kernel', '--to', '9.9.9', '--app', app],
      cwd: framework,
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("unknown version '9.9.9'");
    expect(result.stdout).toBe('');
  });
});
