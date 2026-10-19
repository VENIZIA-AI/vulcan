import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const STYLED_PACKAGE =
  '{ "name": "demo", "devDependencies": { "@venizia/dev-configs": "0.3.1-0" } }';

/** Tests never run a real install. */
const NO_INSTALL = { VULCAN_NO_INSTALL: '1' };

const SCAFFOLD = [
  'AGENTS.md',
  '.configs/vulcan.config.mts',
  '.configs/oxlint.config.mts',
  '.configs/eslint.config.mjs',
  '.configs/oxfmt.config.mts',
  '.agents/rules.md',
  '.agents/knowledge/index.md',
  'Makefile',
];

describe('vulcan init', () => {
  test('an empty project gets the whole layer, mts config by default', () => {
    const root = createProject({ files: { 'package.json': STYLED_PACKAGE } });

    expect(runCli({ args: ['init'], cwd: root, env: NO_INSTALL }).code).toBe(0);

    for (const path of SCAFFOLD) {
      expect(existsSync(join(root, path))).toBe(true);
    }

    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toContain('How to work in demo');
    expect(readFileSync(join(root, 'Makefile'), 'utf8')).toContain(
      'include node_modules/@venizia/vulcan/base/make/vulcan.mk',
    );
    expect(readFileSync(join(root, '.configs/oxlint.config.mts'), 'utf8')).toContain(
      '@venizia/dev-configs',
    );
  });

  for (const extension of ['ts', 'mjs', 'js']) {
    test(`--config ${extension} writes that format only`, () => {
      const root = createProject({ files: {} });

      runCli({ args: ['init', '--config', extension], cwd: root, env: NO_INSTALL });
      expect(existsSync(join(root, `.configs/vulcan.config.${extension}`))).toBe(true);
      expect(existsSync(join(root, '.configs/vulcan.config.mts'))).toBe(false);
    });
  }

  test('an unknown --config value exits 1 and writes nothing', () => {
    const root = createProject({ files: {} });

    expect(runCli({ args: ['init', '--config', 'yaml'], cwd: root, env: NO_INSTALL }).code).toBe(1);
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(false);
  });

  test('never overwrites: existing files are kept, and the missing include is printed', () => {
    const root = createProject({
      files: { 'AGENTS.md': '# mine\n', Makefile: 'build:\n\t@echo\n' },
    });
    const result = runCli({ args: ['init'], cwd: root, env: NO_INSTALL });

    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toBe('# mine\n');
    expect(readFileSync(join(root, 'Makefile'), 'utf8')).toBe('build:\n\t@echo\n');
    expect(result.stderr).toContain('include node_modules/@venizia/vulcan/base/make/vulcan.mk');
  });

  test('an existing config of another format is kept; no second config appears', () => {
    const root = createProject({ files: { '.configs/vulcan.config.mjs': 'export default {};\n' } });

    runCli({ args: ['init'], cwd: root, env: NO_INSTALL });
    expect(existsSync(join(root, '.configs/vulcan.config.mts'))).toBe(false);
  });

  test('missing .gitignore entries are written, existing lines kept', () => {
    const root = createProject({
      files: { '.gitignore': 'node_modules/\n', 'package.json': STYLED_PACKAGE },
    });

    runCli({ args: ['init'], cwd: root, env: NO_INSTALL });
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe(
      'node_modules/\nCLAUDE.md\nCLAUDE.*.md\n.claude/\n.agents/plans\n',
    );
  });

  test('a .gitignore without a final newline gets one before the new lines', () => {
    const root = createProject({
      files: { '.gitignore': 'node_modules/', 'package.json': STYLED_PACKAGE },
    });

    runCli({ args: ['init'], cwd: root, env: NO_INSTALL });
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe(
      'node_modules/\nCLAUDE.md\nCLAUDE.*.md\n.claude/\n.agents/plans\n',
    );
  });

  test('lint tools the scaffolded configs need are installed when undeclared', () => {
    const root = createProject({ files: { 'package.json': '{ "name": "demo" }' } });
    const result = runCli({ args: ['init'], cwd: root, env: NO_INSTALL });

    expect(result.stderr).toContain(
      'skipped  bun add -d oxlint oxlint-tsgolint oxfmt eslint @venizia/dev-configs',
    );
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe('{ "name": "demo" }');
  });

  test('declared lint tools are not installed again', () => {
    const root = createProject({
      files: {
        'package.json':
          '{ "name": "demo", "devDependencies": { "@venizia/dev-configs": "0.3.1", "oxlint": "1", "oxlint-tsgolint": "7", "oxfmt": "0", "eslint": "10" } }',
      },
    });
    const result = runCli({ args: ['init'], cwd: root, env: NO_INSTALL });

    expect(result.stderr).not.toContain('bun add');
  });

  test('a workspaces project installs the style package only', () => {
    const root = createProject({
      files: { 'package.json': '{ "name": "demo", "workspaces": ["apps/*"] }' },
    });
    const result = runCli({ args: ['init'], cwd: root, env: NO_INSTALL });

    expect(result.stderr).toContain('skipped  bun add -d @venizia/dev-configs (VULCAN_NO_INSTALL)');
  });

  test('ends with a numbered list naming the scaffold marker', () => {
    const root = createProject({ files: { 'package.json': STYLED_PACKAGE } });
    const result = runCli({ args: ['init'], cwd: root, env: NO_INSTALL });

    expect(result.stderr).toContain('left to do:');
    expect(result.stderr).toContain(
      '1. describe the project in .agents/knowledge/index.md, then delete the vulcan:scaffold line',
    );
    expect(result.stderr).toContain(
      'bun x --no-install vulcan sync && bun x --no-install vulcan doctor',
    );
  });

  test('.mcp.json is written when absent: the atlas server over this project, pinned with --root', () => {
    const root = createProject({ files: { 'package.json': STYLED_PACKAGE } });
    const result = runCli({ args: ['init'], cwd: root, env: NO_INSTALL });

    expect(JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf8'))).toEqual({
      mcpServers: {
        atlas: {
          command: 'bun',
          args: ['x', '--no-install', 'vulcan', 'x', 'atlas', 'mcp', '--root', '.'],
        },
      },
    });
    expect(result.stderr).toContain('created  .mcp.json');
  });

  test('an existing .mcp.json is never overwritten; one without atlas gets the entry as a hint', () => {
    const mine = '{ "mcpServers": { "other": { "command": "x" } } }\n';
    const root = createProject({ files: { 'package.json': STYLED_PACKAGE, '.mcp.json': mine } });
    const result = runCli({ args: ['init'], cwd: root, env: NO_INSTALL });

    expect(readFileSync(join(root, '.mcp.json'), 'utf8')).toBe(mine);
    expect(result.stderr).toContain('add      .mcp.json: the atlas server');
    expect(result.stderr).toContain(
      '"bun", "args": ["x", "--no-install", "vulcan", "x", "atlas", "mcp", "--root", "."]',
    );
    expect(result.stderr).toContain('--root pins the project');
  });

  test('an existing .mcp.json that already has atlas is kept without a hint', () => {
    const mine = '{ "mcpServers": { "atlas": { "command": "bun", "args": ["x", "atlas"] } } }\n';
    const root = createProject({ files: { 'package.json': STYLED_PACKAGE, '.mcp.json': mine } });
    const result = runCli({ args: ['init'], cwd: root, env: NO_INSTALL });

    expect(readFileSync(join(root, '.mcp.json'), 'utf8')).toBe(mine);
    expect(result.stderr).toContain('kept     .mcp.json');
    expect(result.stderr).not.toContain('the atlas server');
  });

  test('the Makefile explains itself when vulcan.mk is missing: a shipped target says to install first, the project own targets still run', () => {
    const root = createProject({ files: { 'package.json': STYLED_PACKAGE } });

    runCli({ args: ['init'], cwd: root, env: NO_INSTALL });
    writeFileSync(
      join(root, 'Makefile'),
      `${readFileSync(join(root, 'Makefile'), 'utf8')}\ninstall:\n\t@echo installing\n`,
    );

    // Under `make test` the parent's MAKEFLAGS would make the child print "Entering directory".
    const env = { ...process.env, MAKEFLAGS: '', MAKELEVEL: '', MFLAGS: '' };
    const make = (target: string) =>
      Bun.spawnSync(['make', '--no-print-directory', target], {
        cwd: root,
        env,
        stderr: 'pipe',
        stdout: 'pipe',
      });
    const shipped = make('okf-check-strict');
    const own = make('install');

    expect(shipped.exitCode).not.toBe(0);
    expect(shipped.stderr.toString()).toContain("run 'make install' (bun install) first");
    expect(shipped.stderr.toString()).not.toContain('No rule to make target');
    expect(own.exitCode).toBe(0);
    expect(own.stdout.toString()).toBe('installing\n');
    expect(own.stderr.toString()).toBe('');
  });

  test('a workspaces project keeps its lint configs per app: none is written at the root', () => {
    const root = createProject({
      files: { 'package.json': '{ "name": "demo", "workspaces": ["apps/*"] }' },
    });
    const result = runCli({ args: ['init'], cwd: root, env: NO_INSTALL });

    for (const name of ['oxlint.config.mts', 'eslint.config.mjs', 'oxfmt.config.mts']) {
      expect(existsSync(join(root, '.configs', name))).toBe(false);
    }

    expect(existsSync(join(root, '.configs/vulcan.config.mts'))).toBe(true);
    expect(result.stderr).toContain('skipped');
    expect(result.stderr).toContain('per app');
  });

  test('the object form of workspaces counts too', () => {
    const root = createProject({
      files: { 'package.json': '{ "name": "demo", "workspaces": { "packages": ["apps/*"] } }' },
    });

    runCli({ args: ['init'], cwd: root, env: NO_INSTALL });
    expect(existsSync(join(root, '.configs/oxlint.config.mts'))).toBe(false);
  });

  test('init, then sync: doctor names what is left to fill in, and is green once it is', () => {
    const root = createProject({ files: { 'package.json': STYLED_PACKAGE } });

    runCli({ args: ['init'], cwd: root, env: NO_INSTALL });
    runCli({ args: ['sync'], cwd: root });
    const raw = runCli({ args: ['doctor'], cwd: root });

    expect(raw.code).toBe(1);
    expect(raw.stderr).toContain('[scaffold] .agents/knowledge/index.md');

    const index = join(root, '.agents/knowledge/index.md');

    writeFileSync(
      index,
      readFileSync(index, 'utf8')
        .split('\n')
        .filter(line => !line.includes('vulcan:scaffold'))
        .join('\n'),
    );
    const filled = runCli({ args: ['doctor'], cwd: root });

    expect(filled.stderr).toContain('vulcan doctor: OK');
    expect(filled.code).toBe(0);
  });

  test('the scaffolded knowledge bundle is OKF v0.2 conformant', () => {
    const root = createProject({ files: { 'package.json': STYLED_PACKAGE } });

    runCli({ args: ['init'], cwd: root, env: NO_INSTALL });
    const check = runCli({ args: ['x', 'okf', 'check'], cwd: root });

    expect(check.code).toBe(0);
    expect(check.stdout).toContain('OKF v0.2');
  });
});
