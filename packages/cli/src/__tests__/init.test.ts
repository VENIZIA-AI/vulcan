import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createProject, removeProjects } from './helpers/project.ts';
import { runCli } from './helpers/run.ts';

afterAll(removeProjects);

const STYLED_PACKAGE =
  '{ "name": "demo", "devDependencies": { "@venizia/dev-configs": "0.3.1-0" } }';

const SCAFFOLD = [
  'AGENTS.md',
  '.configs/vulcan.config.ts',
  '.configs/oxlint.config.mts',
  '.configs/eslint.config.mjs',
  '.configs/oxfmt.config.mts',
  '.agents/rules.md',
  '.agents/knowledge/index.md',
  'Makefile',
];

describe('vulcan init', () => {
  test('an empty project gets the whole layer, ts config by default', () => {
    const root = createProject({ files: { 'package.json': STYLED_PACKAGE } });

    expect(runCli({ args: ['init'], cwd: root }).code).toBe(0);

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

  for (const extension of ['mts', 'mjs', 'js']) {
    test(`--config ${extension} writes that format only`, () => {
      const root = createProject({ files: {} });

      runCli({ args: ['init', '--config', extension], cwd: root });
      expect(existsSync(join(root, `.configs/vulcan.config.${extension}`))).toBe(true);
      expect(existsSync(join(root, '.configs/vulcan.config.ts'))).toBe(false);
    });
  }

  test('an unknown --config value exits 1 and writes nothing', () => {
    const root = createProject({ files: {} });

    expect(runCli({ args: ['init', '--config', 'yaml'], cwd: root }).code).toBe(1);
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(false);
  });

  test('never overwrites: existing files are kept, and the missing include is printed', () => {
    const root = createProject({
      files: { 'AGENTS.md': '# mine\n', Makefile: 'build:\n\t@echo\n' },
    });
    const result = runCli({ args: ['init'], cwd: root });

    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toBe('# mine\n');
    expect(readFileSync(join(root, 'Makefile'), 'utf8')).toBe('build:\n\t@echo\n');
    expect(result.stderr).toContain('include node_modules/@venizia/vulcan/base/make/vulcan.mk');
  });

  test('an existing config of another format is kept; no second config appears', () => {
    const root = createProject({ files: { '.configs/vulcan.config.mjs': 'export default {};\n' } });

    runCli({ args: ['init'], cwd: root });
    expect(existsSync(join(root, '.configs/vulcan.config.ts'))).toBe(false);
  });

  test('missing .gitignore entries and the style dependency are hints, not edits', () => {
    const root = createProject({
      files: { '.gitignore': 'node_modules/\n', 'package.json': '{ "name": "demo" }' },
    });
    const result = runCli({ args: ['init'], cwd: root });

    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe('node_modules/\n');
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe('{ "name": "demo" }');
    expect(result.stderr).toContain('CLAUDE.md');
    expect(result.stderr).toContain('@venizia/dev-configs');
  });

  test('no .mcp.json is scaffolded (atlas serves wiki checkouts until atlas v1); the entry is a hint, never a download', () => {
    const root = createProject({ files: { 'package.json': STYLED_PACKAGE } });
    const result = runCli({ args: ['init'], cwd: root });

    expect(existsSync(join(root, '.mcp.json'))).toBe(false);
    expect(result.stderr).toContain(
      '"bun", "args": ["x", "--no-install", "vulcan", "x", "atlas", "mcp", "--root", "."]',
    );
  });

  test('init, then sync, then doctor is green', () => {
    const root = createProject({ files: { 'package.json': STYLED_PACKAGE } });

    runCli({ args: ['init'], cwd: root });
    runCli({ args: ['sync'], cwd: root });
    const doctor = runCli({ args: ['doctor'], cwd: root });

    expect(doctor.stderr).toContain('vulcan doctor: OK');
    expect(doctor.code).toBe(0);
  });

  test('the scaffolded knowledge bundle is OKF v0.2 conformant', () => {
    const root = createProject({ files: { 'package.json': STYLED_PACKAGE } });

    runCli({ args: ['init'], cwd: root });
    const check = runCli({ args: ['x', 'okf', 'check'], cwd: root });

    expect(check.code).toBe(0);
    expect(check.stdout).toContain('OKF v0.2');
  });
});
