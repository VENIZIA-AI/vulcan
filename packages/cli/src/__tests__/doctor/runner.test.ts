import { afterAll, describe, expect, test } from 'bun:test';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DoctorChecks,
  parseMakeTargets,
  runDoctorChecks,
  runDoctorNotes,
  runDoctorWarnings,
} from '../../doctor/index.ts';
import { renderLocalChoice } from '../../agents/index.ts';
import { renderBunfig } from '../../create/bunfig.ts';
import { renderDockerignore } from '../../create/dockerignore.ts';
import { isolateOwnerReplySwitch } from '../owner-reply-env.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);
isolateOwnerReplySwitch();

const MAKE_INCLUDE = 'include node_modules/@venizia/vulcan/base/make/vulcan.mk\n';
const LINT_CONFIGS = {
  '.configs/lints/oxlint.config.mts':
    "import { defineConfig } from 'oxlint';\nimport { oxlintConfigs } from '@venizia/dev-configs/linters';\n\nexport default defineConfig(oxlintConfigs);\n",
  '.configs/lints/eslint.config.mjs':
    "import { namingConventionConfigs } from '@venizia/dev-configs/linters';\n\nexport default namingConventionConfigs;\n",
};
const CONFORMANT: Record<string, string> = {
  '.configs/vulcan.config.ts': "export default { rules: { 'V-W-01': 'read-only' } };\n",
  'package.json': '{ "name": "demo", "devDependencies": { "@venizia/dev-configs": "0.3.1-0" } }',
  'AGENTS.md': '# x\n',
  '.agents/rules.md': '| ID | Rule | Enforced by |\n|---|---|---|\n| W-06 | stay | SOFT |\n',
  '.agents/knowledge/index.md': '# k\n',
  Makefile: `${MAKE_INCLUDE}\nbuild:\n\t@echo build\n`,
  '.mcp.json':
    '{ "mcpServers": { "atlas": { "command": "bun", "args": ["x", "--no-install", "vulcan", "x", "atlas", "mcp", "--root", "."] } } }\n',
  'bunfig.toml': renderBunfig(),
  ...LINT_CONFIGS,
};

const createSyncedProject = (opts: { files: Record<string, string> }): string => {
  const root = createProject({ files: opts.files });

  runCli({ args: ['sync'], cwd: root });

  return root;
};

const findChecks = async (opts: { root: string }): Promise<string[]> =>
  (await runDoctorChecks({ root: opts.root })).map((violation) => violation.check);

describe('doctor', () => {
  test('a conformant, synced project has no violations and exits 0', async () => {
    const root = createSyncedProject({ files: CONFORMANT });

    expect(await runDoctorChecks({ root })).toEqual([]);
    const result = runCli({ args: ['doctor'], cwd: root });

    expect(result.code).toBe(0);
    expect(result.stderr).toContain('vulcan doctor: OK');
  });

  test('no config: a config violation, exit 1, no stack trace', () => {
    const result = runCli({ args: ['doctor'], cwd: createProject({ files: {} }) });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('no .configs/vulcan.config.* found');
    expect(result.stderr).not.toContain('    at ');
  });

  test('two config files', async () => {
    const root = createProject({
      files: { ...CONFORMANT, '.configs/vulcan.config.js': 'export default {};\n' },
    });

    expect(await findChecks({ root })).toEqual([DoctorChecks.CONFIG]);
  });

  test('a missing AGENTS.md, rules file or knowledge bundle', async () => {
    const withoutAgents = Object.fromEntries(
      Object.entries(CONFORMANT).filter(([path]) => path !== 'AGENTS.md'),
    );

    expect(await findChecks({ root: createSyncedProject({ files: withoutAgents }) })).toContain(
      DoctorChecks.LAYOUT,
    );
  });

  test('a project rule in the base namespace V-', async () => {
    const root = createSyncedProject({
      files: { ...CONFORMANT, '.agents/rules.md': '| V-W-09 | mine | SOFT |\n' },
    });

    expect(await findChecks({ root })).toEqual([DoctorChecks.RULE_IDS]);
  });

  test('Extends V-Z-99: the base carries no such rule', () => {
    const root = createSyncedProject({
      files: {
        ...CONFORMANT,
        '.agents/rules.md': '| **W-06** | **Extends V-W-04 and V-Z-99.** stay | SOFT |\n',
      },
    });
    const result = runCli({ args: ['doctor'], cwd: root });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      `[${DoctorChecks.RULE_IDS}] .agents/rules.md: V-Z-99 is not a base rule`,
    );
    expect(result.stderr).not.toContain('V-W-04');
  });

  test('a retired base ID, extended or in a first cell', async () => {
    const root = createSyncedProject({
      files: {
        ...CONFORMANT,
        '.agents/rules.md':
          '| **C-03** | **Extends V-C-03.** mine | SOFT |\n| V-W-05 | x | SOFT |\n',
      },
    });
    const violations = await runDoctorChecks({ root });

    expect(violations.map((violation) => violation.message)).toEqual([
      'V-C-03 is retired in the base - drop the reference',
      'V-W-05 is retired in the base - drop the reference',
    ]);
  });

  test("BANA's form: bold bare IDs define, V- IDs the base carries are references", async () => {
    const markdown = [
      '| ID | Rule |',
      '|---|---|',
      '| **W-00** | **Extends V-W-01 (slot `read-only`).** mine |',
      '| **S-01** | **Extends V-S-01 and V-S-07.** mine |',
      '| V-W-02, V-W-03 | the guard-writes hook asks |',
      '| **V-C-04** | quoted from the base |',
    ].join('\n');
    const root = createSyncedProject({ files: { ...CONFORMANT, '.agents/rules.md': markdown } });

    expect(await findChecks({ root })).toEqual([]);
  });

  test("bare W/S/P/B/C IDs are the project's own: they never collide with the base", async () => {
    const rows = ['W-01', 'W-02', 'S-05', 'P-03', 'B-02', 'C-18'].map(
      (id) => `| ${id} | mine | SOFT |`,
    );
    const root = createSyncedProject({
      files: { ...CONFORMANT, '.agents/rules.md': `${rows.join('\n')}\n` },
    });

    expect(await findChecks({ root })).toEqual([]);
  });

  test('a config still keyed by the old bare slot ID names the new one', () => {
    const root = createProject({
      files: {
        ...CONFORMANT,
        '.configs/vulcan.config.ts': "export default { rules: { 'W-01': 'read-only' } };\n",
      },
    });

    expect(runCli({ args: ['doctor'], cwd: root }).stderr).toContain(
      "'W-01' is not a slot - the base rule is now 'V-W-01'",
    );
  });

  test('a missing slot choice', async () => {
    const root = createSyncedProject({
      files: { ...CONFORMANT, '.configs/vulcan.config.ts': 'export default {};\n' },
    });

    expect(await findChecks({ root })).toContain(DoctorChecks.RULE_SLOTS);
  });

  test('an unknown slot option', async () => {
    const root = createSyncedProject({
      files: {
        ...CONFORMANT,
        '.configs/vulcan.config.ts': "export default { rules: { 'V-W-01': 'sometimes' } };\n",
      },
    });

    expect(await findChecks({ root })).toContain(DoctorChecks.RULE_SLOTS);
  });

  test('a choice for an ID that is not a slot', async () => {
    const root = createSyncedProject({
      files: {
        ...CONFORMANT,
        '.configs/vulcan.config.ts':
          "export default { rules: { 'V-W-01': 'read-only', 'V-P-02': 'x' } };\n",
      },
    });

    expect(await findChecks({ root })).toEqual([DoctorChecks.RULE_SLOTS]);
  });

  test('a project skill shadowing a shipped skill', async () => {
    const root = createSyncedProject({
      files: {
        ...CONFORMANT,
        '.agents/skills/knowledge-sync/SKILL.md': '---\nname: knowledge-sync\n---\n',
      },
    });

    expect(await findChecks({ root })).toContain(DoctorChecks.SKILLS);
  });

  test('a Makefile without the include', async () => {
    const root = createSyncedProject({ files: { ...CONFORMANT, Makefile: 'build:\n\t@echo\n' } });

    expect(await findChecks({ root })).toEqual([DoctorChecks.MAKE]);
  });

  test('a Makefile redefining a shipped target', async () => {
    const root = createSyncedProject({
      files: { ...CONFORMANT, Makefile: `${MAKE_INCLUDE}okf-check:\n\t@echo mine\n` },
    });

    expect(await findChecks({ root })).toEqual([DoctorChecks.MAKE]);
  });

  test('a shipped target redefined in an included make/*.mk is found, and named by its file', () => {
    const root = createSyncedProject({
      files: {
        ...CONFORMANT,
        Makefile: `${MAKE_INCLUDE}include make/*.mk\n`,
        'make/knowledge.mk': 'okf-check:\n\t@echo mine\nproject-only:\n\t@echo fine\n',
      },
    });
    const result = runCli({ args: ['doctor'], cwd: root });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      `[${DoctorChecks.MAKE}] make/knowledge.mk: 'okf-check' is a shipped target`,
    );
    expect(result.stderr).not.toContain('project-only');
  });

  test('the shipped vulcan.mk include is never read as project targets', async () => {
    const root = createSyncedProject({
      files: { ...CONFORMANT, Makefile: `${MAKE_INCLUDE}include make/*.mk\n` },
    });

    expect(await findChecks({ root })).toEqual([]);
  });

  test('a config hook that runs a shipped hook', async () => {
    const root = createSyncedProject({
      files: {
        ...CONFORMANT,
        '.configs/vulcan.config.ts':
          "export default { rules: { 'V-W-01': 'read-only' }, hooks: [{ event: 'Stop', command: 'bun node_modules/@venizia/vulcan/base/hooks/guard-writes.ts' }] };\n",
      },
    });

    expect(await findChecks({ root })).toEqual([DoctorChecks.HOOKS]);
  });

  test('never synced: one adapters violation, and the missing manifest', async () => {
    const checks = await findChecks({ root: createProject({ files: CONFORMANT }) });

    expect(checks).toEqual([DoctorChecks.ADAPTERS, DoctorChecks.MANIFEST]);
  });

  test('a hand-written CLAUDE.md', async () => {
    const root = createSyncedProject({ files: { ...CONFORMANT, 'CLAUDE.md': '# mine\n' } });

    expect(await findChecks({ root })).toEqual([DoctorChecks.ADAPTERS]);
  });

  test('an invalid .claude/settings.json', async () => {
    const root = createSyncedProject({ files: CONFORMANT });

    writeFileSync(join(root, '.claude', 'settings.json'), '{ nope');
    expect(await findChecks({ root })).toEqual([DoctorChecks.ADAPTERS]);
  });

  test('no @venizia/dev-configs devDependency', async () => {
    const root = createSyncedProject({
      files: { ...CONFORMANT, 'package.json': '{ "name": "demo" }' },
    });

    expect(await findChecks({ root })).toEqual([DoctorChecks.STYLE]);
  });

  test('a lint config that does not build on the shared one', async () => {
    const root = createSyncedProject({
      files: {
        ...CONFORMANT,
        '.configs/lints/oxlint.config.mts': 'export default { rules: {} };\n',
      },
    });

    expect(await findChecks({ root })).toEqual([DoctorChecks.STYLE]);
  });

  test('a lint config left directly in .configs/ is told where it belongs', async () => {
    const root = createSyncedProject({
      files: {
        ...CONFORMANT,
        '.configs/oxlint.config.mts':
          "import { defineConfig } from 'oxlint';\nimport { oxlintConfigs } from '@venizia/dev-configs/linters';\n\nexport default defineConfig(oxlintConfigs);\n",
      },
    });
    const violations = await runDoctorChecks({ root });
    const legacy = violations.filter(
      (violation) => violation.file === '.configs/oxlint.config.mts',
    );

    expect(legacy.map((violation) => violation.check)).toEqual([DoctorChecks.STYLE]);
    expect(legacy[0].message).toBe('move it to .configs/lints/oxlint.config.mts');
  });

  test('a lint config under lints/ is where the style check looks', async () => {
    const root = createSyncedProject({
      files: {
        ...CONFORMANT,
        '.configs/lints/eslint.config.mjs': 'export default [];\n',
      },
    });

    expect(await findChecks({ root })).toEqual([DoctorChecks.STYLE]);
  });

  test('a package lint config is checked too', async () => {
    const root = createSyncedProject({
      files: {
        ...CONFORMANT,
        'packages/app/.configs/lints/oxlint.config.mts': 'export default {};\n',
      },
    });

    expect(await findChecks({ root })).toEqual([DoctorChecks.STYLE]);
  });

  // D9: the style package comes from the package whose .configs/ holds the lint config (BANA's shape).
  const PACKAGE_LINT_CONFIGS = Object.fromEntries(
    Object.entries(LINT_CONFIGS).map(([file, text]) => [join('packages', 'app', file), text]),
  );
  const WITHOUT_ROOT_STYLE = Object.fromEntries(
    Object.entries(CONFORMANT).filter(([file]) => !(file in LINT_CONFIGS)),
  );

  test('the style package declared by the package that holds the lint configs is enough', async () => {
    const root = createSyncedProject({
      files: {
        ...WITHOUT_ROOT_STYLE,
        'package.json': '{ "name": "demo" }',
        'packages/app/package.json':
          '{ "name": "@demo/app", "devDependencies": { "@venizia/dev-configs": "0.3.1-0" } }',
        ...PACKAGE_LINT_CONFIGS,
      },
    });

    expect(await findChecks({ root })).toEqual([]);
  });

  test('a package lint config whose package and root both lack the style package fails', async () => {
    const root = createSyncedProject({
      files: {
        ...WITHOUT_ROOT_STYLE,
        'package.json': '{ "name": "demo" }',
        'packages/app/package.json': '{ "name": "@demo/app" }',
        ...PACKAGE_LINT_CONFIGS,
      },
    });

    expect(await findChecks({ root })).toEqual([DoctorChecks.STYLE]);
  });

  test("a configured package outside packages/ is an owner too (BANA's umbras/kit)", async () => {
    const root = createSyncedProject({
      files: {
        ...CONFORMANT,
        '.configs/vulcan.config.ts':
          "export default { rules: { 'V-W-01': 'read-only' }, packages: [{ dir: 'kit', name: '@demo/kit', path: 'umbras/kit' }] };\n",
        'umbras/kit/package.json': '{ "name": "@demo/kit" }',
        'umbras/kit/.configs/lints/oxlint.config.mts': 'export default {};\n',
      },
    });
    const violations = await runDoctorChecks({ root });

    expect(violations.map((violation) => [violation.check, violation.file])).toEqual([
      [DoctorChecks.STYLE, 'umbras/kit/.configs/lints/oxlint.config.mts'],
    ]);
  });

  test('every violation goes to stderr with its check and file; nothing to stdout', () => {
    const root = createProject({
      files: { ...CONFORMANT, '.agents/rules.md': '| V-W-09 | mine | SOFT |\n' },
    });
    const result = runCli({ args: ['doctor'], cwd: root });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`[${DoctorChecks.RULE_IDS}]`);
    expect(result.stderr).toContain('.agents/rules.md');
    expect(result.stdout).toBe('');
  });
});

describe('doctor on a clean checkout', () => {
  test('adapters that were never written are one line with the fix, not one stale line per file', async () => {
    const root = createProject({ files: CONFORMANT });
    const adapters = (await runDoctorChecks({ root })).filter(
      (violation) => violation.check === DoctorChecks.ADAPTERS,
    );

    expect(adapters).toHaveLength(1);
    expect(adapters[0]?.message).toBe(
      "not synced yet - run 'bun x --no-install vulcan sync' (make agent-setup) first",
    );
    expect(adapters[0]?.message).not.toContain('stale');
  });

  test('an adapter that exists but differs stays a stale line naming its file', async () => {
    const root = createSyncedProject({ files: CONFORMANT });

    writeFileSync(join(root, '.claude/settings.json'), '{ "permissions": { "allow": ["x"] } }\n');
    const adapters = (await runDoctorChecks({ root })).filter(
      (violation) => violation.check === DoctorChecks.ADAPTERS,
    );

    expect(adapters.map((violation) => violation.file)).toContain('.claude/settings.json');
    expect(adapters.every((violation) => !violation.message.includes('not synced yet'))).toBe(true);
  });
});

describe('doctor: the scaffold is filled in', () => {
  const WORKSPACES_PACKAGE =
    '{ "name": "demo", "workspaces": ["apps/*"], "devDependencies": { "@venizia/dev-configs": "0.3.1-0" } }';

  test('a workspaces project that declares no packages fails', async () => {
    const root = createSyncedProject({
      files: { ...CONFORMANT, 'package.json': WORKSPACES_PACKAGE },
    });
    const violations = await runDoctorChecks({ root });

    expect(violations.map((violation) => violation.check)).toEqual([DoctorChecks.SCAFFOLD]);
    expect(violations[0]?.message).toContain('packages');
  });

  test('the same project passes once the config lists its packages', async () => {
    const root = createSyncedProject({
      files: {
        ...CONFORMANT,
        'package.json': WORKSPACES_PACKAGE,
        '.configs/vulcan.config.ts':
          "export default { rules: { 'V-W-01': 'read-only' }, packages: [{ dir: 'api', name: '@demo/api', path: 'apps/api' }] };\n",
      },
    });

    expect(await runDoctorChecks({ root })).toEqual([]);
  });

  test('a single-package project needs no packages', async () => {
    expect(await runDoctorChecks({ root: createSyncedProject({ files: CONFORMANT }) })).toEqual([]);
  });

  test('a knowledge index that still carries the scaffold marker fails', async () => {
    const root = createSyncedProject({
      files: {
        ...CONFORMANT,
        '.agents/knowledge/index.md':
          '# k\n\n<!-- vulcan:scaffold - describe the project, then delete this line -->\n',
      },
    });
    const violations = await runDoctorChecks({ root });

    expect(violations.map((violation) => violation.check)).toEqual([DoctorChecks.SCAFFOLD]);
    expect(violations[0]?.file).toBe('.agents/knowledge/index.md');
  });
});

describe('doctor: apps', () => {
  test('a layout folder outside workspaces and an app outside every layout folder are violations', async () => {
    const root = createSyncedProject({
      files: {
        ...CONFORMANT,
        'package.json':
          '{ "name": "demo", "workspaces": ["services/*"], "devDependencies": { "@venizia/dev-configs": "0.3.1-0" } }',
        '.configs/vulcan.config.ts':
          "export default { rules: { 'V-W-01': 'read-only' }, layout: { backend: 'services', frontend: 'web' }, packages: [{ dir: 'core-api', name: 'core-api', path: 'apps/core-api' }] };\n",
      },
    });
    const violations = await runDoctorChecks({ root });
    const apps = violations
      .filter((violation) => violation.check === DoctorChecks.APPS)
      .map((violation) => violation.message);

    expect(apps).toContain("layout.frontend 'web' is not in package.json workspaces - add 'web/*'");
    expect(apps).toContain(
      'package core-api lives at apps/core-api, outside every layout folder (services, web)',
    );
  });

  test('a lib package may live outside every layout folder, if a workspace glob covers it', async () => {
    const files = (opts: { workspaces: string }) => ({
      ...CONFORMANT,
      'package.json': `{ "name": "demo", "workspaces": ${opts.workspaces}, "devDependencies": { "@venizia/dev-configs": "0.3.1-0" } }`,
      '.configs/vulcan.config.ts':
        "export default { rules: { 'V-W-01': 'read-only' }, layout: { backend: 'services' }, packages: [{ dir: 'merchant', name: '@nx/merchant', path: 'auroras/features/merchant', kind: 'lib' }] };\n",
    });
    const covered = createSyncedProject({
      files: files({ workspaces: '["services/*", "auroras/features/*"]' }),
    });
    const uncovered = createSyncedProject({ files: files({ workspaces: '["services/*"]' }) });

    expect(await runDoctorChecks({ root: covered })).toEqual([]);
    expect(
      (await runDoctorChecks({ root: uncovered }))
        .filter((violation) => violation.check === DoctorChecks.APPS)
        .map((violation) => violation.message),
    ).toContain(
      "package merchant lives at auroras/features/merchant, which no workspace glob covers - add 'auroras/features/*' to workspaces",
    );
  });

  test('workspace globs written folder/** or ./folder/* cover the layout folder', async () => {
    for (const globs of [['services/**'], ['./services/*'], ['./services/**']]) {
      const root = createSyncedProject({
        files: {
          ...CONFORMANT,
          'package.json': `{ "name": "demo", "workspaces": ${JSON.stringify(globs)}, "devDependencies": { "@venizia/dev-configs": "0.3.1-0" } }`,
          '.configs/vulcan.config.ts':
            "export default { rules: { 'V-W-01': 'read-only' }, layout: { backend: 'services' }, packages: [{ dir: 'core-api', name: 'core-api', path: 'services/core-api' }] };\n",
        },
      });

      expect(await runDoctorChecks({ root })).toEqual([]);
    }
  });

  test('a glob for a different folder still leaves the layout folder uncovered', async () => {
    const root = createSyncedProject({
      files: {
        ...CONFORMANT,
        'package.json':
          '{ "name": "demo", "workspaces": ["./other/**"], "devDependencies": { "@venizia/dev-configs": "0.3.1-0" } }',
        '.configs/vulcan.config.ts':
          "export default { rules: { 'V-W-01': 'read-only' }, layout: { backend: 'services' } };\n",
      },
    });
    const apps = (await runDoctorChecks({ root })).filter(
      (violation) => violation.check === DoctorChecks.APPS,
    );

    expect(apps.map((violation) => violation.message)).toContain(
      "layout.backend 'services' is not in package.json workspaces - add 'services/*'",
    );
  });

  test('a project without a layout is not checked', async () => {
    expect(await findChecks({ root: createSyncedProject({ files: CONFORMANT }) })).not.toContain(
      DoctorChecks.APPS,
    );
  });
});

describe('doctor: app scripts (info only)', () => {
  const STANDARD = {
    'server:dev': 'vite',
    compile: 'sh scripts/compile.sh',
    typecheck: 'bun check',
    lint: 'sh scripts/lint.sh',
    'lint:fix': 'sh scripts/lint.sh --fix',
    test: 'bun test',
    clean: 'sh scripts/clean.sh',
  };
  const CONFIG = (opts: { packages: string }): string =>
    `export default { rules: { 'V-W-01': 'read-only' }, layout: { backend: 'services', frontend: 'web', shared: 'libs' }, packages: ${opts.packages} };\n`;
  const project = (opts: { files: Record<string, string>; packages: string }): string =>
    createSyncedProject({
      files: {
        ...CONFORMANT,
        'package.json':
          '{ "name": "demo", "workspaces": ["services/*", "web/*", "libs/*"], "devDependencies": { "@venizia/dev-configs": "0.3.1-0" } }',
        '.configs/vulcan.config.ts': CONFIG({ packages: opts.packages }),
        ...opts.files,
      },
    });
  const manifest = (opts: { name: string; scripts: Record<string, string> }): string =>
    JSON.stringify({ name: opts.name, scripts: opts.scripts });

  test('an app with the seven standard scripts, and a domain extra, has no note', async () => {
    const root = project({
      packages: "[{ dir: 'api', name: 'api', path: 'services/api' }]",
      files: {
        'services/api/package.json': manifest({
          name: 'api',
          scripts: { ...STANDARD, 'migrate:dev': 'bun run migrate.ts' },
        }),
      },
    });

    expect(await runDoctorNotes({ root })).toEqual([]);
  });

  test('one line per app names the missing standard scripts and the legacy ones it carries', async () => {
    const root = project({
      packages:
        "[{ dir: 'api', name: 'api', path: 'services/api' }, { dir: 'admin', name: 'admin', path: 'web/admin' }]",
      files: {
        'services/api/package.json': manifest({
          name: 'api',
          scripts: {
            dev: 'bun run src/index.ts',
            start: 'bun run dist/index.js',
            test: 'bun test',
          },
        }),
        'web/admin/package.json': manifest({
          name: 'admin',
          scripts: { ...STANDARD, build: 'vite build', preview: 'vite preview' },
        }),
      },
    });
    const notes = await runDoctorNotes({ root });

    expect(notes).toHaveLength(2);
    expect(notes[0]).toEqual({
      check: DoctorChecks.SCRIPTS,
      file: 'services/api/package.json',
      message:
        'app api: missing server:dev, compile, typecheck, lint, lint:fix, clean; legacy dev, start (use the standard names)',
    });
    expect(notes[1]?.message).toBe('app admin: legacy build, preview (use the standard names)');
  });

  test('all six legacy names are recognised', async () => {
    const root = project({
      packages: "[{ dir: 'api', name: 'api', path: 'services/api' }]",
      files: {
        'services/api/package.json': manifest({
          name: 'api',
          scripts: {
            ...STANDARD,
            dev: 'x',
            start: 'x',
            build: 'x',
            rebuild: 'x',
            preview: 'x',
            'server:prod': 'x',
          },
        }),
      },
    });

    expect((await runDoctorNotes({ root }))[0]?.message).toBe(
      'app api: legacy dev, start, build, rebuild, preview, server:prod (use the standard names)',
    );
  });

  test('shared code, retired packages, an app without a package.json and a project without a layout are not noted', async () => {
    const root = project({
      packages:
        "[{ dir: 'kit', name: 'kit', path: 'libs/kit' }, { dir: 'old', name: 'old', path: 'services/old', retired: true }, { dir: 'ghost', name: 'ghost', path: 'services/ghost' }]",
      files: {
        'libs/kit/package.json': manifest({ name: 'kit', scripts: { build: 'tsc' } }),
        'services/old/package.json': manifest({ name: 'old', scripts: { dev: 'x' } }),
      },
    });

    expect(await runDoctorNotes({ root })).toEqual([]);
    expect(await runDoctorNotes({ root: createSyncedProject({ files: CONFORMANT }) })).toEqual([]);
  });

  test('notes never fail: runDoctorChecks stays clean and the doctor command exits 0, printing them as info', async () => {
    const root = project({
      packages: "[{ dir: 'api', name: 'api', path: 'services/api' }]",
      files: {
        'services/api/package.json': manifest({ name: 'api', scripts: { dev: 'x' } }),
      },
    });
    const result = runCli({ args: ['doctor'], cwd: root });

    expect(await runDoctorChecks({ root })).toEqual([]);
    expect(result.code).toBe(0);
    expect(result.stderr).toContain(
      '  info [scripts] services/api/package.json: app api: missing server:dev, compile, typecheck, lint, lint:fix, test, clean; legacy dev (use the standard names)\n',
    );
    expect(result.stderr).toContain('vulcan doctor: OK');
  });
});

describe('doctor: agents', () => {
  test('a broken local choice file is a violation that says how to fix it', async () => {
    const root = createSyncedProject({
      files: { ...CONFORMANT, '.agents/vulcan.local.json': '{ nope' },
    });
    const agents = (await runDoctorChecks({ root })).filter(
      (violation) => violation.check === DoctorChecks.AGENTS,
    );

    expect(agents).toEqual([
      {
        check: DoctorChecks.AGENTS,
        file: '.agents/vulcan.local.json',
        message:
          '.agents/vulcan.local.json is not valid JSON - delete it and run: vulcan sync --agents <list>',
      },
    ]);
  });

  test('a stored choice that leaves Claude out means no Claude adapters are checked', async () => {
    const root = createProject({
      files: { ...CONFORMANT, '.agents/vulcan.local.json': renderLocalChoice({ agents: ['omp'] }) },
    });

    runCli({ args: ['sync'], cwd: root });

    expect((await runDoctorChecks({ root })).map((violation) => violation.check)).not.toContain(
      DoctorChecks.ADAPTERS,
    );
  });
});

describe('parseMakeTargets', () => {
  test('reads rule targets; skips recipes, variables, .PHONY and pattern rules', () => {
    const makefile =
      'A := 1\nB ?= 2\n.PHONY: x\nbuild: dep\n\t@echo\nokf-check:\n\techo\n$(T): %-x:\n';

    expect(parseMakeTargets({ makefile })).toEqual(['build', 'okf-check']);
  });
});

describe('doctor: a Dockerfile and the root .dockerignore (warnings)', () => {
  const dockerignoreWarnings = async (opts: { root: string }) =>
    (await runDoctorWarnings(opts)).filter((item) => item.check === DoctorChecks.DOCKERIGNORE);
  const PACKAGES = "[{ dir: 'api', name: 'api', path: 'services/api' }]";
  const SAFE = '**/node_modules\n**/.env\n**/.env.*\n!**/.env.example\n';
  const project = (opts: { files: Record<string, string> }): string =>
    createSyncedProject({
      files: {
        ...CONFORMANT,
        'package.json':
          '{ "name": "demo", "workspaces": ["services/*"], "devDependencies": { "@venizia/dev-configs": "0.3.1-0" } }',
        '.configs/vulcan.config.ts': `export default { rules: { 'V-W-01': 'read-only' }, layout: { backend: 'services' }, packages: ${PACKAGES} };\n`,
        'services/api/package.json': JSON.stringify({
          name: 'api',
          scripts: {
            'server:dev': 'x',
            compile: 'x',
            typecheck: 'x',
            lint: 'x',
            'lint:fix': 'x',
            test: 'x',
            clean: 'x',
          },
        }),
        'services/api/.configs/builders/Dockerfile': 'FROM x\n',
        ...opts.files,
      },
    });
  const ADD =
    'add **/.env, **/.env.* and !**/.env.example (in that order) to the root .dockerignore';

  test('no root .dockerignore: one warning, and never an info note', async () => {
    const root = project({ files: {} });

    expect(await dockerignoreWarnings({ root })).toEqual([
      {
        check: DoctorChecks.DOCKERIGNORE,
        file: '.dockerignore',
        message: `app api has a Dockerfile and the root has no .dockerignore: the build context would carry node_modules, dist, .git and every .env file (secrets) - create it, then ${ADD}`,
      },
    ]);
    expect((await runDoctorNotes({ root })).map((note) => note.check)).not.toContain(
      DoctorChecks.DOCKERIGNORE,
    );
  });

  test('a .dockerignore without the .env lines: one warning naming the three lines', async () => {
    const root = project({ files: { '.dockerignore': '**/node_modules\n**/dist\n' } });

    expect(await dockerignoreWarnings({ root })).toEqual([
      {
        check: DoctorChecks.DOCKERIGNORE,
        file: '.dockerignore',
        message: `app api has a Dockerfile and the root .dockerignore does not exclude .env files, which hold secrets and would land in the image layer: ${ADD}`,
      },
    ]);
  });

  test('only .env excluded, not .env.*, still warns', async () => {
    const root = project({ files: { '.dockerignore': '**/.env\n' } });

    expect((await dockerignoreWarnings({ root })).length).toBe(1);
  });

  test('the lines doctor asks for, and the usual spellings of them, are accepted', async () => {
    for (const text of [SAFE, '.env\n.env.*\n', '.env*\n!.env.example\n', '**/.env*\n']) {
      const root = project({ files: { '.dockerignore': text } });

      expect(await dockerignoreWarnings({ root }), text).toEqual([]);
    }
  });

  test('the .dockerignore that init writes passes the check', async () => {
    const root = project({ files: { '.dockerignore': renderDockerignore() } });

    expect(await dockerignoreWarnings({ root })).toEqual([]);
  });

  test('a later negation that brings .env back is a warning again', async () => {
    const root = project({ files: { '.dockerignore': '**/.env\n**/.env.*\n!**/.env*\n' } });

    expect((await dockerignoreWarnings({ root })).length).toBe(1);
  });

  test('no Dockerfile: silent', async () => {
    const root = project({ files: {} });

    rmSync(join(root, 'services/api/.configs/builders/Dockerfile'));
    expect(await dockerignoreWarnings({ root })).toEqual([]);
  });

  test('two apps with a Dockerfile give one warning naming both', async () => {
    const root = project({
      files: {
        '.configs/vulcan.config.ts': `export default { rules: { 'V-W-01': 'read-only' }, layout: { backend: 'services' }, packages: [{ dir: 'api', name: 'api', path: 'services/api' }, { dir: 'jobs', name: 'jobs', path: 'services/jobs' }] };\n`,
        'services/jobs/.configs/builders/Dockerfile': 'FROM x\n',
        'services/jobs/package.json': JSON.stringify({ name: 'jobs', scripts: {} }),
        '.dockerignore': '**/node_modules\n',
      },
    });
    const warnings = await dockerignoreWarnings({ root });

    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('apps api, jobs have a Dockerfile');
  });

  test('doctor prints a warning line, stays green, and says how many', () => {
    const root = project({ files: { '.dockerignore': '**/node_modules\n' } });
    const result = runCli({ args: ['doctor'], cwd: root });

    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toContain('  warning [dockerignore] .dockerignore: ');
    expect(result.stderr).toContain('vulcan doctor: OK with 1 warning(s)');
  });
});

describe('doctor: bun fmt (warnings)', () => {
  const formatWarnings = async (opts: { root: string }) =>
    (await runDoctorWarnings(opts)).filter((item) => item.check === DoctorChecks.FORMAT);
  const PACKAGES = "[{ dir: 'api', name: 'api', path: 'services/api' }]";
  const project = (opts: { files: Record<string, string | null> }): string =>
    createSyncedProject({
      files: Object.fromEntries(
        Object.entries({
          ...CONFORMANT,
          'package.json':
            '{ "name": "demo", "workspaces": ["services/*"], "devDependencies": { "@venizia/dev-configs": "0.3.1-0" } }',
          '.configs/vulcan.config.ts': `export default { rules: { 'V-W-01': 'read-only' }, layout: { backend: 'services' }, packages: ${PACKAGES} };\n`,
          'services/api/package.json': JSON.stringify({ name: 'api', scripts: { lint: 'x' } }),
          ...opts.files,
        }).filter((entry): entry is [string, string] => entry[1] !== null),
      ),
    });
  const ADD_SECTION =
    'add a [fmt] section (printWidth = 100, singleQuote = true, arrowParens = "always", flavor = "oxfmt"): without it bun fmt formats with Bun\'s defaults, not the shared style';
  const FLAVOR_ADVICE =
    'without it bun fmt formats like Prettier when oxfmt is not a dependency, and the output changes';

  test('the bunfig.toml that init writes passes', async () => {
    expect(await formatWarnings({ root: project({ files: {} }) })).toEqual([]);
  });

  test('no bunfig.toml: one warning', async () => {
    const root = project({ files: { 'bunfig.toml': null } });

    expect(await formatWarnings({ root })).toEqual([
      {
        check: DoctorChecks.FORMAT,
        file: 'bunfig.toml',
        message: `missing - ${ADD_SECTION}`,
      },
    ]);
  });

  test('a bunfig.toml without [fmt]: one warning', async () => {
    const root = project({ files: { 'bunfig.toml': 'telemetry = false\n' } });

    expect(await formatWarnings({ root })).toEqual([
      {
        check: DoctorChecks.FORMAT,
        file: 'bunfig.toml',
        message: `no [fmt] section - ${ADD_SECTION}`,
      },
    ]);
  });

  test('a [fmt] section is found with comments and spacing, and only as a table header', async () => {
    for (const text of [
      '[fmt]\nflavor = "oxfmt"\n',
      "  [fmt]  # style\nflavor = 'oxfmt'\n",
      'telemetry = false\n\n[fmt]\nsemi = false\nflavor = "oxfmt"\n',
    ]) {
      const root = project({ files: { 'bunfig.toml': text } });

      expect(await formatWarnings({ root }), text).toEqual([]);
    }

    const root = project({ files: { 'bunfig.toml': '# [fmt] is not set here\nfmt = 1\n' } });

    expect((await formatWarnings({ root })).length).toBe(1);
  });

  test('a fmt script in the root package.json: one warning', async () => {
    const root = project({
      files: {
        'package.json': JSON.stringify({
          name: 'demo',
          workspaces: ['services/*'],
          scripts: { fmt: 'oxfmt .' },
          devDependencies: { '@venizia/dev-configs': '0.3.1-0' },
        }),
      },
    });

    expect(await formatWarnings({ root })).toEqual([
      {
        check: DoctorChecks.FORMAT,
        file: 'package.json',
        message:
          'defines a "fmt" script: bun fmt runs it instead of formatting - rename it (the standard names are lint and lint:fix)',
      },
    ]);
  });

  test('a fmt script in a package: one warning naming that package.json', async () => {
    const root = project({
      files: {
        'services/api/package.json': JSON.stringify({
          name: 'api',
          scripts: { lint: 'x', fmt: 'x' },
        }),
      },
    });
    const warnings = await formatWarnings({ root });

    expect(warnings).toHaveLength(1);
    expect(warnings[0].file).toBe('services/api/package.json');
  });

  test('an oxfmt config left in .configs/formatters/ is unused: one warning to delete it', async () => {
    const root = project({
      files: { 'services/api/.configs/formatters/oxfmt.config.mts': 'export default {};\n' },
    });

    expect(await formatWarnings({ root })).toEqual([
      {
        check: DoctorChecks.FORMAT,
        file: 'services/api/.configs/formatters/oxfmt.config.mts',
        message:
          'not used any more: bun fmt formats with the [fmt] section of bunfig.toml - delete it',
      },
    ]);
  });

  test('an oxfmt config bun fmt loads by itself overrides [fmt]: one warning per file', async () => {
    const root = project({
      files: { '.oxfmtrc.json': '{}\n', 'services/api/oxfmt.config.ts': 'export default {};\n' },
    });
    const message =
      'bun fmt loads it and it overrides the [fmt] section of bunfig.toml - delete it, or move its settings to [fmt]';

    expect(await formatWarnings({ root })).toEqual([
      { check: DoctorChecks.FORMAT, file: '.oxfmtrc.json', message },
      { check: DoctorChecks.FORMAT, file: 'services/api/oxfmt.config.ts', message },
    ]);
  });

  test('a [fmt] copy in an app folder: one warning, the root is the one decider', async () => {
    const root = project({
      files: { 'services/api/bunfig.toml': renderBunfig() },
    });

    expect(await formatWarnings({ root })).toEqual([
      {
        check: DoctorChecks.FORMAT,
        file: 'services/api/bunfig.toml',
        message:
          'a [fmt] copy: bun fmt inherits the root bunfig.toml, and a copy here can drift from it - delete the section',
      },
    ]);
  });

  test("a bunfig.toml in an app folder without [fmt] is not the check's business", async () => {
    const root = project({ files: { 'services/api/bunfig.toml': '[install]\nexact = true\n' } });

    expect(await formatWarnings({ root })).toEqual([]);
  });

  test('a bunfig.toml [fmt] section without the oxfmt flavor: one warning', async () => {
    const root = project({
      files: { 'bunfig.toml': '[fmt]\nprintWidth = 100\n' },
    });

    expect(await formatWarnings({ root })).toEqual([
      {
        check: DoctorChecks.FORMAT,
        file: 'bunfig.toml',
        message: `[fmt] has no flavor = "oxfmt" - ${FLAVOR_ADVICE}`,
      },
    ]);
  });

  test('doctor prints the warning lines and stays green', () => {
    const root = project({ files: { 'bunfig.toml': null } });
    const result = runCli({ args: ['doctor'], cwd: root });

    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toContain('  warning [format] bunfig.toml: missing - ');
  });
});

describe('doctor: the atlas server is registered the canonical way (warnings)', () => {
  const ENTRY =
    '"atlas": { "command": "bun", "args": ["x", "--no-install", "vulcan", "x", "atlas", "mcp", "--root", "."] }';
  const MCP = (opts: { name?: string; root?: string }): string =>
    JSON.stringify({
      mcpServers: {
        [opts.name ?? 'atlas']: {
          command: 'bun',
          args: ['x', '--no-install', 'vulcan', 'x', 'atlas', 'mcp', '--root', opts.root ?? '.'],
        },
      },
    });
  const mcpWarnings = async (opts: { root: string }) =>
    (await runDoctorWarnings(opts)).filter((item) => item.check === DoctorChecks.MCP);
  // sync writes the canonical file; a test then replaces it, as a hand edit or a tracked file would.
  const project = (opts: { mcp?: string; agents?: string[] }) => {
    const root = createSyncedProject({ files: CONFORMANT });

    if (opts.agents !== undefined) {
      writeFileSync(
        join(root, '.agents/vulcan.local.json'),
        renderLocalChoice({ agents: opts.agents }),
      );
    }

    if (opts.mcp !== undefined) {
      writeFileSync(join(root, '.mcp.json'), opts.mcp);
    }

    return root;
  };

  test('the canonical entry sync wrote and the enabled server: no warning', async () => {
    expect(await mcpWarnings({ root: project({}) })).toEqual([]);
  });

  test('no .mcp.json: the adapters check says not synced yet, the mcp check stays quiet', async () => {
    const root = project({});

    rmSync(join(root, '.mcp.json'));

    expect(await mcpWarnings({ root })).toEqual([]);
    expect(
      (await runDoctorChecks({ root })).some(
        (violation) => violation.check === DoctorChecks.ADAPTERS,
      ),
    ).toBe(true);
  });

  test('a file that is not JSON', async () => {
    const warnings = await mcpWarnings({ root: project({ mcp: '{ nope' }) });

    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toBe(`not valid JSON - it must hold ${ENTRY} under mcpServers`);
  });

  test('the atlas server under another name: Claude never auto-enables it', async () => {
    const warnings = await mcpWarnings({ root: project({ mcp: MCP({ name: 'ignis-atlas' }) }) });

    expect(warnings).toEqual([
      {
        check: DoctorChecks.MCP,
        file: '.mcp.json',
        message: `no server named atlas (found: ignis-atlas): a differently named server is not enabled automatically - use ${ENTRY}`,
      },
    ]);
  });

  test('an atlas entry that serves another root', async () => {
    const warnings = await mcpWarnings({ root: project({ mcp: MCP({ root: '../ignis' }) }) });

    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toBe(
      `the atlas entry is { "command": "bun", "args": ["x", "--no-install", "vulcan", "x", "atlas", "mcp", "--root", "../ignis"] }, expected ${ENTRY}`,
    );
  });

  test('a machine whose agents do not read .mcp.json is not asked about it', async () => {
    const root = project({ agents: ['cursor'], mcp: MCP({ root: '../ignis' }) });

    expect((await mcpWarnings({ root })).map((item) => item.file)).not.toContain('.mcp.json');
  });

  test('the managed Claude settings that do not enable atlas', async () => {
    const root = project({ mcp: MCP({}) });

    writeFileSync(
      join(root, '.claude/settings.json'),
      JSON.stringify({ enabledMcpjsonServers: ['ignis-knowledge'] }),
    );

    expect(await mcpWarnings({ root })).toEqual([
      {
        check: DoctorChecks.MCP,
        file: '.claude/settings.json',
        message:
          'enabledMcpjsonServers does not include atlas (has: ignis-knowledge): Claude asks before using the server - run vulcan sync',
      },
    ]);
  });

  test('no Claude settings yet: silent about them', async () => {
    const root = project({ mcp: MCP({}) });

    rmSync(join(root, '.claude/settings.json'), { force: true });
    expect(await mcpWarnings({ root })).toEqual([]);
  });

  test('doctor prints them as warnings and stays green', () => {
    const root = project({ mcp: MCP({ root: '../ignis' }) });
    const result = runCli({ args: ['doctor'], cwd: root });

    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toContain('  warning [mcp] .mcp.json: the atlas entry is');
  });
});

describe('the report shape note', () => {
  test('counts the replies that broke the shape from the log, and says nothing without one', async () => {
    const root = createProject({
      files: {
        '.configs/vulcan.config.ts': "export default { rules: { 'V-W-01': 'read-only' } };\n",
        '.agents/local/violations.jsonl':
          '{"date":"2026-10-24","classes":["emoji","blocked-missing"]}\n{"date":"2026-10-25","classes":["emoji"]}\n',
      },
    });
    const quiet = createProject({
      files: {
        '.configs/vulcan.config.ts': "export default { rules: { 'V-W-01': 'read-only' } };\n",
      },
    });
    const notes = (await runDoctorNotes({ root })).filter((note) =>
      note.file.endsWith('violations.jsonl'),
    );

    expect(notes).toHaveLength(1);
    expect(notes[0]?.message).toBe(
      '2 replies were flagged on 2 days (emoji 2, blocked-missing 1); the retro skill turns a pattern into a check',
    );
    expect(
      (await runDoctorNotes({ root: quiet })).filter((note) =>
        note.file.endsWith('violations.jsonl'),
      ),
    ).toEqual([]);
  });

  test('a note says when VULCAN_OWNER_REPLY=off is set in the shell that runs doctor', async () => {
    const root = createProject({
      files: {
        '.configs/vulcan.config.ts': "export default { rules: { 'V-W-01': 'read-only' } };\n",
      },
    });
    const notesOf = async (env: Record<string, string>): Promise<string[]> =>
      (await runDoctorNotes({ root, env }))
        .filter((note) => note.file === 'VULCAN_OWNER_REPLY')
        .map((note) => note.message);

    const set = await notesOf({ VULCAN_OWNER_REPLY: 'off' });

    expect(set).toHaveLength(1);
    expect(set[0]).toContain('not held to the owner reply shape');
    expect(await notesOf({ VULCAN_OWNER_REPLY: 'OFF' })).toEqual([]);
    expect(await notesOf({})).toEqual([]);
  });

  test('a warning says when a Claude Code settings file of the project sets the switch in env', async () => {
    const config = "export default { rules: { 'V-W-01': 'read-only' } };\n";
    const flagged = createProject({
      files: {
        '.configs/vulcan.config.ts': config,
        '.claude/settings.local.json': JSON.stringify({ env: { VULCAN_OWNER_REPLY: 'off' } }),
      },
    });
    const harmless = createProject({
      files: {
        '.configs/vulcan.config.ts': config,
        '.claude/settings.json': JSON.stringify({ env: { VULCAN_OWNER_REPLY: 'on' } }),
      },
    });
    const warningsOf = async (root: string): Promise<string[]> =>
      (await runDoctorWarnings({ root }))
        .filter((warning) => warning.message.includes('VULCAN_OWNER_REPLY'))
        .map((warning) => warning.file);

    expect(await warningsOf(flagged)).toEqual(['.claude/settings.local.json']);
    expect(await warningsOf(harmless)).toEqual([]);
  });
});
