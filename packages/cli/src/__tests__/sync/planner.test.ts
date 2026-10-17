import { afterAll, describe, expect, test } from 'bun:test';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const PACKAGE_ROOT = join(import.meta.dir, '..', '..', '..');

const READ_ONLY_PROJECT = {
  '.configs/vulcan.config.ts': "export default { rules: { 'V-W-01': 'read-only' } };\n",
  'AGENTS.md': '# x\n',
};

const runSync = (opts: { root: string }) => runCli({ args: ['sync'], cwd: opts.root });

const readSettings = (opts: { root: string }) =>
  JSON.parse(readFileSync(join(opts.root, '.claude', 'settings.json'), 'utf8'));

describe('CLAUDE.md', () => {
  test('absent: created as the @AGENTS.md import file', () => {
    const root = createProject({ files: READ_ONLY_PROJECT });

    expect(runSync({ root }).code).toBe(0);
    expect(lstatSync(join(root, 'CLAUDE.md')).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf8')).toBe('@AGENTS.md\n');
  });

  test('a symlink to AGENTS.md: replaced', () => {
    const root = createProject({ files: READ_ONLY_PROJECT });

    symlinkSync('AGENTS.md', join(root, 'CLAUDE.md'));
    expect(runSync({ root }).stderr).toContain('replaced');
    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf8')).toBe('@AGENTS.md\n');
  });

  test('a symlink to some other file: still an old adapter, replaced', () => {
    const root = createProject({ files: { ...READ_ONLY_PROJECT, 'README.md': 'hi\n' } });

    symlinkSync('README.md', join(root, 'CLAUDE.md'));
    runSync({ root });
    expect(lstatSync(join(root, 'CLAUDE.md')).isSymbolicLink()).toBe(false);
  });

  test('a hand-written CLAUDE.md is never touched', () => {
    const root = createProject({ files: { ...READ_ONLY_PROJECT, 'CLAUDE.md': '# mine\n' } });

    expect(runSync({ root }).stderr).toContain('skipped');
    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf8')).toBe('# mine\n');
  });
});

describe('.claude/settings.json', () => {
  test('shipped hooks and the read-only deny list merge in; personal keys survive', () => {
    const root = createProject({
      files: {
        ...READ_ONLY_PROJECT,
        '.claude/settings.json': '{ "model": "opus", "permissions": { "allow": ["Bash(ls)"] } }',
      },
    });

    runSync({ root });
    const settings = readSettings({ root });

    expect(settings.model).toBe('opus');
    expect(settings.permissions.allow).toEqual(['Bash(ls)']);
    expect(settings.permissions.deny).toContain('Bash(git commit:*)');
    expect(settings.hooks.SessionStart).toBeDefined();
    expect(settings.hooks.PreToolUse).toBeDefined();
  });

  test('on-user-word adds no deny list', () => {
    const root = createProject({
      files: {
        ...READ_ONLY_PROJECT,
        '.configs/vulcan.config.ts': "export default { rules: { 'V-W-01': 'on-user-word' } };\n",
      },
    });

    runSync({ root });
    expect(readSettings({ root }).permissions?.deny).toBeUndefined();
  });

  test('config hooks are appended after the shipped ones', () => {
    const root = createProject({
      files: {
        ...READ_ONLY_PROJECT,
        '.configs/vulcan.config.ts':
          "export default { rules: { 'V-W-01': 'read-only' }, hooks: [{ event: 'Stop', command: 'echo bye' }, { event: 'PreToolUse', matcher: 'Edit', command: 'echo edit' }] };\n",
      },
    });

    runSync({ root });
    const settings = readSettings({ root });

    expect(settings.hooks.Stop[0].hooks[0].command).toBe('echo bye');
    expect(settings.hooks.PreToolUse).toHaveLength(2);
    expect(settings.hooks.PreToolUse[1].matcher).toBe('Edit');
  });

  test('switching V-W-01 back to on-user-word removes the deny list sync added', () => {
    const root = createProject({ files: READ_ONLY_PROJECT });

    runSync({ root });
    writeFileSync(
      join(root, '.configs/vulcan.config.ts'),
      "export default { rules: { 'V-W-01': 'on-user-word' } };\n",
    );
    expect(runSync({ root }).stderr).toContain('replaced');
    expect(readSettings({ root }).permissions?.deny).toBeUndefined();
  });

  test('a config hook removed from the config is removed from the settings', () => {
    const root = createProject({
      files: {
        ...READ_ONLY_PROJECT,
        '.configs/vulcan.config.ts':
          "export default { rules: { 'V-W-01': 'read-only' }, hooks: [{ event: 'Stop', command: 'echo bye' }] };\n",
      },
    });

    runSync({ root });
    writeFileSync(
      join(root, '.configs/vulcan.config.ts'),
      "export default { rules: { 'V-W-01': 'read-only' } };\n",
    );
    runSync({ root });
    expect(readSettings({ root }).hooks.Stop).toBeUndefined();
  });

  test('claude.settings from the config are shared, removable, and never touch personal keys', () => {
    const root = createProject({
      files: {
        ...READ_ONLY_PROJECT,
        '.claude/settings.json': '{ "model": "opus", "permissions": { "allow": ["Bash(ls)"] } }',
        '.configs/vulcan.config.ts':
          "export default { rules: { 'V-W-01': 'read-only' }, claude: { settings: { env: { CI: '1' }, permissions: { allow: ['Bash(make test)'] } } } };\n",
      },
    });

    runSync({ root });
    const shared = readSettings({ root });

    expect(shared.env).toEqual({ CI: '1' });
    expect(shared.permissions.allow).toEqual(['Bash(ls)', 'Bash(make test)']);

    writeFileSync(
      join(root, '.configs/vulcan.config.ts'),
      "export default { rules: { 'V-W-01': 'read-only' } };\n",
    );
    runSync({ root });
    const after = readSettings({ root });

    expect(after.env).toBeUndefined();
    expect(after.permissions.allow).toEqual(['Bash(ls)']);
    expect(after.model).toBe('opus');
  });

  test('a settings file whose keys start with the shipped ones is current after one sync, and doctor agrees', () => {
    const root = createProject({
      files: {
        ...READ_ONLY_PROJECT,
        '.claude/settings.json':
          '{ "$schema": "https://json.schemastore.org/claude-code-settings.json", "model": "opus" }',
      },
    });

    runSync({ root });
    const second = runSync({ root });

    expect(second.stderr).toContain('unchanged .claude/settings.json');
    expect(Object.keys(readSettings({ root }))[0]).toBe('$schema');
    expect(runCli({ args: ['doctor'], cwd: root }).stderr).not.toContain('.claude/settings.json');
  });

  test('invalid JSON is left alone, reported, and fails the sync', () => {
    const root = createProject({
      files: { ...READ_ONLY_PROJECT, '.claude/settings.json': '{ nope' },
    });
    const result = runSync({ root });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('not valid JSON');
    expect(readFileSync(join(root, '.claude', 'settings.json'), 'utf8')).toBe('{ nope');
  });
});

describe('skills', () => {
  test('shipped and project skills are linked into .claude/skills', () => {
    const root = createProject({
      files: { ...READ_ONLY_PROJECT, '.agents/skills/mine/SKILL.md': '---\nname: mine\n---\n' },
    });

    runSync({ root });
    expect(readlinkSync(join(root, '.claude', 'skills', 'knowledge-sync'))).toContain(
      'base/skills/knowledge-sync',
    );
    expect(existsSync(join(root, '.claude', 'skills', 'mine', 'SKILL.md'))).toBe(true);
  });

  test('a project skill named like a shipped one: no crash, the shipped one wins, the clash is reported, sync stays idempotent', () => {
    const root = createProject({
      files: {
        ...READ_ONLY_PROJECT,
        '.agents/skills/docs-writing/SKILL.md': '---\nname: docs-writing\n---\n',
      },
    });
    const first = runSync({ root });

    expect(first.code).toBe(0);
    expect(first.stderr).not.toContain('    at ');
    expect(first.stderr).toContain('shadows a shipped skill');
    expect(readlinkSync(join(root, '.claude', 'skills', 'docs-writing'))).toContain(
      'base/skills/docs-writing',
    );
    const second = runSync({ root });

    expect(second.stderr).not.toContain('replaced');
    expect(readlinkSync(join(root, '.claude', 'skills', 'docs-writing'))).toContain(
      'base/skills/docs-writing',
    );
  });

  test('a shipped skill links through node_modules/@venizia/vulcan, never the store path behind it', () => {
    const root = createProject({ files: READ_ONLY_PROJECT });
    const installed = join(root, 'node_modules', '@venizia', 'vulcan');

    // bun's isolated install: node_modules/@venizia/vulcan is a link into a hashed store directory,
    // which every upgrade replaces - a skill linked there dies with it.
    mkdirSync(dirname(installed), { recursive: true });
    symlinkSync(PACKAGE_ROOT, installed);
    runSync({ root });

    expect(readlinkSync(join(root, '.claude', 'skills', 'knowledge-sync'))).toBe(
      join(installed, 'base', 'skills', 'knowledge-sync'),
    );
  });

  test('a dead link left by an older install is replaced by the stable one', () => {
    const root = createProject({ files: READ_ONLY_PROJECT });
    const installed = join(root, 'node_modules', '@venizia', 'vulcan');
    const link = join(root, '.claude', 'skills', 'knowledge-sync');

    mkdirSync(dirname(installed), { recursive: true });
    symlinkSync(PACKAGE_ROOT, installed);
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(
      join(root, 'node_modules', '.bun', 'gone', 'base', 'skills', 'knowledge-sync'),
      link,
    );

    expect(runSync({ root }).stderr).toContain('replaced');
    expect(readlinkSync(link)).toBe(join(installed, 'base', 'skills', 'knowledge-sync'));
    expect(existsSync(join(link, 'SKILL.md'))).toBe(true);
  });

  test('a real directory where a skill link belongs is left alone', () => {
    const root = createProject({
      files: { ...READ_ONLY_PROJECT, '.claude/skills/knowledge-sync/SKILL.md': 'mine' },
    });

    expect(runSync({ root }).stderr).toContain('skipped');
    expect(
      readFileSync(join(root, '.claude', 'skills', 'knowledge-sync', 'SKILL.md'), 'utf8'),
    ).toBe('mine');
  });
});

describe('idempotence and output', () => {
  test('a second run reports every action unchanged and writes nothing to stdout', () => {
    const root = createProject({ files: READ_ONLY_PROJECT });

    runSync({ root });
    const second = runSync({ root });

    expect(second.code).toBe(0);
    expect(second.stderr).not.toContain('created');
    expect(second.stderr).not.toContain('replaced');
    expect(second.stdout).toBe('');
  });

  test('--dry-run changes nothing', () => {
    const root = createProject({ files: READ_ONLY_PROJECT });

    runCli({ args: ['sync', '--dry-run'], cwd: root });
    expect(existsSync(join(root, 'CLAUDE.md'))).toBe(false);
  });

  test('no config: exit 1 with the lookup error, no stack trace', () => {
    const result = runSync({ root: createProject({ files: {} }) });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('no .configs/vulcan.config.* found');
    expect(result.stderr).not.toContain('    at ');
  });
});
