import { afterAll, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DoctorChecks, parseMakeTargets, runDoctorChecks } from '../../doctor/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const MAKE_INCLUDE = 'include node_modules/@venizia/vulcan/base/make/vulcan.mk\n';
const LINT_CONFIGS = {
  '.configs/oxlint.config.mts':
    "import { defineConfig } from 'oxlint';\nimport { oxlintConfigs } from '@venizia/dev-configs/linters';\n\nexport default defineConfig(oxlintConfigs);\n",
  '.configs/eslint.config.mjs':
    "import { namingConventionConfigs } from '@venizia/dev-configs/linters';\n\nexport default namingConventionConfigs;\n",
  '.configs/oxfmt.config.mts':
    "import { defineConfig } from 'oxfmt';\nimport { oxfmtConfigs } from '@venizia/dev-configs/formatters';\n\nexport default defineConfig(oxfmtConfigs);\n",
};
const CONFORMANT: Record<string, string> = {
  '.configs/vulcan.config.ts': "export default { rules: { 'V-W-01': 'read-only' } };\n",
  'package.json': '{ "name": "demo", "devDependencies": { "@venizia/dev-configs": "0.3.1-0" } }',
  'AGENTS.md': '# x\n',
  '.agents/rules.md': '| ID | Rule | Enforced by |\n|---|---|---|\n| W-06 | stay | SOFT |\n',
  '.agents/knowledge/index.md': '# k\n',
  Makefile: `${MAKE_INCLUDE}\nbuild:\n\t@echo build\n`,
  ...LINT_CONFIGS,
};

const createSyncedProject = (opts: { files: Record<string, string> }): string => {
  const root = createProject({ files: opts.files });

  runCli({ args: ['sync'], cwd: root });

  return root;
};

const findChecks = async (opts: { root: string }): Promise<string[]> =>
  (await runDoctorChecks({ root: opts.root })).map(violation => violation.check);

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

    expect(violations.map(violation => violation.message)).toEqual([
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
      id => `| ${id} | mine | SOFT |`,
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

  test('never synced: one violation per missing adapter, and the missing manifest', async () => {
    const checks = await findChecks({ root: createProject({ files: CONFORMANT }) });

    expect(checks.length).toBeGreaterThan(2);
    expect(new Set(checks)).toEqual(new Set([DoctorChecks.ADAPTERS, DoctorChecks.MANIFEST]));
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
      files: { ...CONFORMANT, '.configs/oxlint.config.mts': 'export default { rules: {} };\n' },
    });

    expect(await findChecks({ root })).toEqual([DoctorChecks.STYLE]);
  });

  test('a package lint config is checked too', async () => {
    const root = createSyncedProject({
      files: { ...CONFORMANT, 'packages/app/.configs/oxfmt.config.mts': 'export default {};\n' },
    });

    expect(await findChecks({ root })).toEqual([DoctorChecks.STYLE]);
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

describe('parseMakeTargets', () => {
  test('reads rule targets; skips recipes, variables, .PHONY and pattern rules', () => {
    const makefile =
      'A := 1\nB ?= 2\n.PHONY: x\nbuild: dep\n\t@echo\nokf-check:\n\techo\n$(T): %-x:\n';

    expect(parseMakeTargets({ makefile })).toEqual(['build', 'okf-check']);
  });
});
