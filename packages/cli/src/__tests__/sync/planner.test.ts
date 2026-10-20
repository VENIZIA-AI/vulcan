import { afterAll, describe, expect, test } from 'bun:test';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { runDoctorChecks } from '../../doctor/index.ts';
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

  test('a CLAUDE.md written by bun init is replaced by the import line', () => {
    const root = createProject({
      files: {
        ...READ_ONLY_PROJECT,
        'CLAUDE.md':
          '\nDefault to using Bun instead of Node.js.\n\n- Use `bun <file>` instead of `node <file>` or `ts-node <file>`\n',
      },
    });
    const result = runSync({ root });

    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf8')).toBe('@AGENTS.md\n');
    expect(result.stderr).toContain("bun init's template");
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

  test('the read-only slot denies the whole git write surface, each verb with and without arguments', () => {
    const root = createProject({ files: READ_ONLY_PROJECT });

    runSync({ root });
    const deny: string[] = readSettings({ root }).permissions.deny;
    const verbs = [
      'add',
      'rm',
      'mv',
      'restore',
      'commit',
      'push',
      'pull',
      'merge',
      'rebase',
      'reset',
      'revert',
      'cherry-pick',
      'checkout',
      'switch',
      'branch',
      'tag',
      'stash',
      'clean',
      'apply',
      'am',
      'worktree',
      'remote',
      'config',
      'submodule',
      'update-ref',
      'filter-branch',
      'gc',
      'init',
      'clone',
      'notes',
    ];

    for (const verb of verbs) {
      expect(deny).toContain(`Bash(git ${verb}:*)`);
    }

    // The bare form too, for the verbs a person types alone.
    for (const verb of [
      'add',
      'commit',
      'push',
      'pull',
      'merge',
      'rebase',
      'reset',
      'checkout',
      'branch',
      'stash',
    ]) {
      expect(deny).toContain(`Bash(git ${verb})`);
    }
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
    // guard-writes and guard-manifest ship; the config's hook comes after both.
    expect(settings.hooks.PreToolUse).toHaveLength(3);
    expect(settings.hooks.PreToolUse[2].matcher).toBe('Edit');
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

  // What an older VULCAN shipped, recorded by its sync; a developer then hand-edited the entry.
  const OLD_GUARD =
    'bun "${CLAUDE_PROJECT_DIR}"/node_modules/@venizia/vulcan/base/hooks/guard-writes.ts';

  const guardCommandsOf = (opts: { root: string }): string[] =>
    Object.values(readSettings(opts).hooks as Record<string, { hooks: { command: string }[] }[]>)
      .flatMap(entries => entries.flatMap(entry => entry.hooks.map(hook => hook.command)))
      .filter(command => command.includes('guard-writes.ts'));

  test('an upgrade takes back a hand-edited shipped hook by its command; other hooks in its entry stay', () => {
    const root = createProject({ files: READ_ONLY_PROJECT });

    runSync({ root });

    const [shipped] = guardCommandsOf({ root });
    const managedPath = join(root, '.claude', 'vulcan-managed.json');
    const settingsPath = join(root, '.claude', 'settings.json');

    for (const path of [managedPath, settingsPath]) {
      writeFileSync(
        path,
        readFileSync(path, 'utf8').replace(JSON.stringify(shipped), JSON.stringify(OLD_GUARD)),
      );
    }

    const settings = readSettings({ root });
    const [entry] = settings.hooks.PreToolUse;

    entry.hooks[0].timeout = 30;
    entry.hooks.push({ type: 'command', command: 'echo mine' });
    writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);

    runSync({ root });

    expect(guardCommandsOf({ root })).toEqual([shipped]);
    expect(JSON.stringify(readSettings({ root }).hooks.PreToolUse)).toContain('echo mine');
  });

  test('a shipped hook with a hand-added timeout is not registered twice', () => {
    const root = createProject({ files: READ_ONLY_PROJECT });

    runSync({ root });

    const settings = readSettings({ root });

    settings.hooks.PreToolUse[0].hooks[0].timeout = 30;
    writeFileSync(join(root, '.claude', 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`);
    runSync({ root });

    expect(guardCommandsOf({ root })).toHaveLength(1);
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

  test('a .claude/skills that is a symlink is never written through - links stay inside the project', () => {
    const root = createProject({ files: READ_ONLY_PROJECT });
    const elsewhere = createProject({ files: {} });

    mkdirSync(join(root, '.claude'), { recursive: true });
    symlinkSync(elsewhere, join(root, '.claude', 'skills'));

    const result = runSync({ root });

    expect(result.stderr).toContain('.claude/skills (a symlink - left untouched)');
    expect(existsSync(join(elsewhere, 'knowledge-sync'))).toBe(false);
  });

  test('a shipped skill this version no longer has: doctor flags its dead link, plain sync takes it back', async () => {
    const root = createProject({ files: READ_ONLY_PROJECT });
    const installed = join(root, 'node_modules', '@venizia', 'vulcan');
    const link = join(root, '.claude', 'skills', 'gone-skill');

    mkdirSync(dirname(installed), { recursive: true });
    symlinkSync(PACKAGE_ROOT, installed);
    runSync({ root });
    // What a newer VULCAN linked before the project went back to this one.
    symlinkSync(join(installed, 'base', 'skills', 'gone-skill'), link);

    const flagged = (await runDoctorChecks({ root })).map(violation => violation.file);

    expect(flagged).toContain('.claude/skills/gone-skill');

    const result = runSync({ root });

    expect(result.stderr).toContain('removed   .claude/skills/gone-skill');
    expect(lstatSync(dirname(link)).isDirectory()).toBe(true);
    expect(() => lstatSync(link)).toThrow();
  });

  test('a skill the user writes reaches Claude, and when the user removes it sync takes its dead link back', () => {
    const root = createProject({
      files: { ...READ_ONLY_PROJECT, '.agents/skills/mine/SKILL.md': '---\nname: mine\n---\n' },
    });

    runSync({ root });
    expect(readlinkSync(join(root, '.claude', 'skills', 'mine'))).toBe(
      join(root, '.agents', 'skills', 'mine'),
    );

    rmSync(join(root, '.agents', 'skills', 'mine'), { recursive: true });

    const result = runSync({ root });

    expect(result.stderr).toContain('removed   .claude/skills/mine (a skill that is gone)');
    expect(() => lstatSync(join(root, '.claude', 'skills', 'mine'))).toThrow();
    expect(lstatSync(join(root, '.claude', 'skills', 'knowledge-sync')).isSymbolicLink()).toBe(
      true,
    );
  });

  test('a skill the user adds later is linked on the next sync', () => {
    const root = createProject({ files: READ_ONLY_PROJECT });

    runSync({ root });
    mkdirSync(join(root, '.agents', 'skills', 'later'), { recursive: true });
    writeFileSync(join(root, '.agents', 'skills', 'later', 'SKILL.md'), '---\nname: later\n---\n');

    expect(runSync({ root }).stderr).toContain('created   .claude/skills/later');
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

    // The first run keeps today's Claude default, the second finds the Claude files and stores the
    // choice once; from then on every action is unchanged.
    runSync({ root });
    runSync({ root });
    const third = runSync({ root });

    expect(third.code).toBe(0);
    expect(third.stderr).not.toContain('created');
    expect(third.stderr).not.toContain('replaced');
    expect(third.stdout).toBe('');
  });

  test('--dry-run changes nothing', () => {
    const root = createProject({ files: READ_ONLY_PROJECT });

    runCli({ args: ['sync', '--dry-run'], cwd: root });
    expect(existsSync(join(root, 'CLAUDE.md'))).toBe(false);
  });

  test('--dry-run says what it would do, in one column; a real run keeps its labels', () => {
    const root = createProject({ files: READ_ONLY_PROJECT });
    const dryRun = runCli({ args: ['sync', '--dry-run'], cwd: root }).stderr;

    expect(dryRun).toContain('  would create  CLAUDE.md\n');
    expect(dryRun).not.toMatch(/^ {2}(?:created|replaced|removed) /m);

    // The widest label is 'would replace': every path starts in the same column after it.
    for (const line of dryRun.trimEnd().split('\n')) {
      expect(line.slice(15, 17), line).toMatch(/^ \S$/);
    }

    expect(runSync({ root }).stderr).toContain('  created   CLAUDE.md\n');
  });

  test('no config: exit 1 with the lookup error, no stack trace', () => {
    const result = runSync({ root: createProject({ files: {} }) });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('no .configs/vulcan.config.* found');
    expect(result.stderr).not.toContain('    at ');
  });
});

describe('planSync with the resolved agents', () => {
  test('without claude no Claude file is planned, with claude the adapters come too', async () => {
    const { planSync } = await import('../../sync/index.ts');
    const { loadConfig } = await import('../../config/index.ts');
    const root = createProject({ files: READ_ONLY_PROJECT });
    const loaded = await loadConfig({ root });

    if (!loaded.ok) {
      throw new Error(loaded.error);
    }

    const without = planSync({ root, config: loaded.config, agents: ['omp'] });
    const withClaude = planSync({ root, config: loaded.config, agents: ['claude', 'omp'] });

    expect(without.map(action => action.path)).toEqual([
      join(root, '.agents/skills/docs-writing'),
      join(root, '.agents/skills/knowledge-sync'),
      join(root, '.agents/skills/docs-update'),
      join(root, '.agents/vulcan.manifest.json'),
    ]);
    expect(without.some(action => action.path === join(root, 'CLAUDE.md'))).toBe(false);
    expect(withClaude.length).toBeGreaterThan(without.length);
    expect(withClaude.some(action => action.path === join(root, 'CLAUDE.md'))).toBe(true);
  });
});

describe('.mcp.json approval for Claude', () => {
  test('the atlas server of the project .mcp.json is enabled in the managed settings', () => {
    const root = createProject({ files: READ_ONLY_PROJECT });

    runSync({ root });

    expect(readSettings({ root }).enabledMcpjsonServers).toEqual(['atlas']);
  });

  test("the user's own approved servers stay, atlas joins them once", () => {
    const root = createProject({
      files: {
        ...READ_ONLY_PROJECT,
        '.claude/settings.json': JSON.stringify({ enabledMcpjsonServers: ['mine'] }),
      },
    });

    runSync({ root });
    runSync({ root });

    expect(readSettings({ root }).enabledMcpjsonServers).toEqual(['mine', 'atlas']);
  });

  test('a second run reports the settings unchanged', () => {
    const root = createProject({ files: READ_ONLY_PROJECT });

    runSync({ root });

    expect(runSync({ root }).stderr).toContain('unchanged .claude/settings.json');
  });

  test("taking Claude back removes atlas from the list and keeps the user's servers", () => {
    const root = createProject({
      files: {
        ...READ_ONLY_PROJECT,
        '.claude/settings.json': JSON.stringify({ enabledMcpjsonServers: ['mine'] }),
      },
    });

    runCli({ args: ['sync', '--agents', 'claude'], cwd: root });
    runCli({ args: ['agents', 'remove', 'claude'], cwd: root });

    expect(readSettings({ root }).enabledMcpjsonServers).toEqual(['mine']);
  });
});
