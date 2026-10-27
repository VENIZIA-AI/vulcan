import { afterAll, describe, expect, test } from 'bun:test';
import { symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inspectCommand, listedScriptOf, trustOf, TrustStates } from '../../hooks/index.ts';
import { git, initRepo } from '../git-repo.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { SPAWN_TIMEOUT_MS } from '@venizia/dev-configs/testing';

afterAll(removeProjects);

const HOOK = join(import.meta.dir, '..', '..', '..', 'base', 'hooks', 'guard-writes.ts');
const MUTATING = join(import.meta.dir, '..', 'fixtures', 'guard-writes', 'mutating-script.ts');
const BODY = "await fetch(url, { method: 'POST' });\nexport {};\n";
const EDITED = `${BODY}// edited\n`;

const repoWith = (opts: { files: Record<string, string> }): string => {
  const root = createProject({ files: opts.files });

  initRepo({ cwd: root });

  return root;
};

const stateOf = (opts: { root: string; script: string }): string => trustOf(opts).state;

describe('trustOf', () => {
  test('a tracked script identical to HEAD is trusted', () => {
    const root = repoWith({ files: { 'tools/cli.ts': BODY } });

    expect(trustOf({ root, script: 'tools/cli.ts' }).state).toBe(TrustStates.TRUSTED);
  });

  test('an edit in the working tree is modified', () => {
    const root = repoWith({ files: { 'cli.ts': BODY } });

    writeFileSync(join(root, 'cli.ts'), EDITED);

    expect(stateOf({ root, script: 'cli.ts' })).toBe(TrustStates.MODIFIED);
    expect(trustOf({ root, script: 'cli.ts' }).reason).toContain('modified trusted script');
  });

  test('a staged edit whose working tree was restored is modified', () => {
    const root = repoWith({ files: { 'cli.ts': BODY } });

    writeFileSync(join(root, 'cli.ts'), EDITED);
    git({ cwd: root, args: ['add', 'cli.ts'] });
    writeFileSync(join(root, 'cli.ts'), BODY);

    expect(stateOf({ root, script: 'cli.ts' })).toBe(TrustStates.MODIFIED);
  });

  test('assume-unchanged hides nothing', () => {
    const root = repoWith({ files: { 'cli.ts': BODY } });

    git({ cwd: root, args: ['update-index', '--assume-unchanged', 'cli.ts'] });
    writeFileSync(join(root, 'cli.ts'), EDITED);

    expect(git({ cwd: root, args: ['status', '--short'] })).toBe('');
    expect(stateOf({ root, script: 'cli.ts' })).toBe(TrustStates.MODIFIED);
  });

  test('skip-worktree hides nothing', () => {
    const root = repoWith({ files: { 'cli.ts': BODY } });

    git({ cwd: root, args: ['update-index', '--skip-worktree', 'cli.ts'] });
    writeFileSync(join(root, 'cli.ts'), EDITED);

    expect(git({ cwd: root, args: ['status', '--short'] })).toBe('');
    expect(stateOf({ root, script: 'cli.ts' })).toBe(TrustStates.MODIFIED);
  });

  test('a file that was never added is untracked', () => {
    const root = repoWith({ files: { 'a.ts': BODY } });

    writeFileSync(join(root, 'new.ts'), BODY);

    expect(stateOf({ root, script: 'new.ts' })).toBe(TrustStates.UNTRACKED);
    expect(trustOf({ root, script: 'new.ts' }).reason).toContain('not tracked');
  });

  test('a file added but not committed is uncommitted', () => {
    const root = repoWith({ files: { 'a.ts': BODY } });

    writeFileSync(join(root, 'new.ts'), BODY);
    git({ cwd: root, args: ['add', 'new.ts'] });

    expect(stateOf({ root, script: 'new.ts' })).toBe(TrustStates.UNCOMMITTED);
  });

  test('a missing file is missing', () => {
    const root = repoWith({ files: { 'a.ts': BODY } });

    expect(stateOf({ root, script: 'gone.ts' })).toBe(TrustStates.MISSING);
  });

  test('a path through a symlinked directory is a symlink', () => {
    const root = repoWith({ files: { 'real/cli.ts': BODY } });

    symlinkSync(join(root, 'real'), join(root, 'alias'));

    expect(stateOf({ root, script: 'alias/cli.ts' })).toBe(TrustStates.SYMLINK);
  });

  test('a tracked symlink file is a symlink, even when its target is tracked', () => {
    const root = createProject({ files: { 'real.ts': BODY } });

    symlinkSync(join(root, 'real.ts'), join(root, 'link.ts'));
    initRepo({ cwd: root });

    expect(stateOf({ root, script: 'link.ts' })).toBe(TrustStates.SYMLINK);
  });

  test('a directory that is not a repository is unknown', () => {
    const root = createProject({ files: { 'cli.ts': BODY } });

    expect(stateOf({ root, script: 'cli.ts' })).toBe(TrustStates.UNKNOWN);
  });

  test('a name with spaces is matched literally', () => {
    const root = repoWith({ files: { 'my tools/the cli.ts': BODY } });

    expect(stateOf({ root, script: 'my tools/the cli.ts' })).toBe(TrustStates.TRUSTED);
  });

  test('glob characters in a name are matched literally, not as a pattern', () => {
    const root = repoWith({ files: { 'a.ts': BODY, 'tools/[x].ts': BODY } });

    writeFileSync(join(root, 'tools', 'x.ts'), BODY);

    expect(stateOf({ root, script: 'tools/[x].ts' })).toBe(TrustStates.TRUSTED);
    expect(stateOf({ root, script: 'tools/x.ts' })).toBe(TrustStates.UNTRACKED);
  });

  test('a star in a name does not match its neighbours', () => {
    const root = repoWith({ files: { 'tools/a.ts': BODY } });

    writeFileSync(join(root, 'tools', '*.ts'), BODY);

    expect(stateOf({ root, script: 'tools/*.ts' })).toBe(TrustStates.UNTRACKED);
  });
});

describe('trustOf with the project in a subfolder of the repository', () => {
  const subProject = (): { parent: string; root: string } => {
    const parent = createProject({
      files: {
        'app/.configs/vulcan.config.ts': 'export default {};\n',
        'app/tools/cli.ts': BODY,
      },
    });

    initRepo({ cwd: parent });

    return { parent, root: join(parent, 'app') };
  };

  test('a committed script is trusted', () => {
    const { root } = subProject();

    expect(stateOf({ root, script: 'tools/cli.ts' })).toBe(TrustStates.TRUSTED);
  });

  test('an edited script is modified', () => {
    const { root } = subProject();

    writeFileSync(join(root, 'tools', 'cli.ts'), EDITED);

    expect(stateOf({ root, script: 'tools/cli.ts' })).toBe(TrustStates.MODIFIED);
  });
});

describe('listedScriptOf', () => {
  const root = '/proj';
  const scripts = ['tools/cli.ts', 'x.ts'];

  test('a relative target from the root matches', () => {
    expect(listedScriptOf({ target: 'tools/cli.ts', cwd: root, root, scripts })).toBe(
      'tools/cli.ts',
    );
  });

  test('an absolute target matches', () => {
    expect(listedScriptOf({ target: '/proj/tools/cli.ts', cwd: '/elsewhere', root, scripts })).toBe(
      'tools/cli.ts',
    );
  });

  test('a ./ target matches', () => {
    expect(listedScriptOf({ target: './x.ts', cwd: root, root, scripts })).toBe('x.ts');
  });

  test('a target run from a subfolder resolves against that cwd', () => {
    expect(listedScriptOf({ target: '../tools/cli.ts', cwd: '/proj/sub', root, scripts })).toBe(
      'tools/cli.ts',
    );
  });

  test('the same name in another folder is not the listed script', () => {
    expect(listedScriptOf({ target: 'tools/cli.ts', cwd: '/proj/sub', root, scripts })).toBe(
      undefined,
    );
  });

  test('no prefix, suffix or glob matching', () => {
    expect(listedScriptOf({ target: 'tools/cli.ts.bak', cwd: root, root, scripts })).toBe(
      undefined,
    );
    expect(listedScriptOf({ target: 'tools/cli.tsx', cwd: root, root, scripts })).toBe(undefined);
    expect(listedScriptOf({ target: 'old/tools/cli.ts', cwd: root, root, scripts })).toBe(
      undefined,
    );
    expect(
      listedScriptOf({ target: 'tools/cli.ts', cwd: root, root, scripts: ['tools/*.ts'] }),
    ).toBe(undefined);
    expect(listedScriptOf({ target: 'tools/cli.ts', cwd: root, root, scripts: ['tools'] })).toBe(
      undefined,
    );
  });

  test('an empty list matches nothing', () => {
    expect(listedScriptOf({ target: 'x.ts', cwd: root, root, scripts: [] })).toBe(undefined);
  });
});

describe('inspectCommand with trust', () => {
  const trusted = (opts: { script: string; files?: Record<string, string> }) => {
    const root = repoWith({ files: { [opts.script]: BODY, ...opts.files } });

    return { root, trust: { root, scripts: [opts.script] } };
  };

  test('a listed, clean script is quiet', () => {
    const { root, trust } = trusted({ script: 'cli.ts' });

    expect(inspectCommand({ command: 'bun cli.ts', cwd: root, trust })).toEqual([]);
  });

  test('the same body without trust is flagged', () => {
    const { root } = trusted({ script: 'cli.ts' });

    expect(inspectCommand({ command: 'bun cli.ts', cwd: root }).length).toBeGreaterThan(0);
  });

  test('the fixture shape of a mutating helper is flagged by default and quiet when listed', () => {
    const root = createProject({ files: { 'mutating-script.ts': BODY } });

    initRepo({ cwd: root });
    writeFileSync(join(root, 'mutating-script.ts'), BODY);

    expect(inspectCommand({ command: `bun ${MUTATING}`, cwd: root }).length).toBeGreaterThan(0);
    expect(
      inspectCommand({
        command: 'bun mutating-script.ts',
        cwd: root,
        trust: { root, scripts: ['mutating-script.ts'] },
      }),
    ).toEqual([]);
  });

  test('a listed script run from a subfolder is quiet', () => {
    const { root, trust } = trusted({ script: 'tools/cli.ts', files: { 'sub/keep.txt': 'x' } });

    expect(
      inspectCommand({ command: 'bun ../tools/cli.ts', cwd: join(root, 'sub'), trust }),
    ).toEqual([]);
  });

  test('a listed but modified script asks, saying modified trusted script', () => {
    const { root, trust } = trusted({ script: 'cli.ts' });

    writeFileSync(join(root, 'cli.ts'), EDITED);

    const hits = inspectCommand({ command: 'bun cli.ts', cwd: root, trust });

    expect(hits.length).toBeGreaterThan(0);
    expect(hits.map((hit) => hit.message).join('\n')).toContain('modified trusted script');
  });

  test('an unlisted script asks', () => {
    const { root } = trusted({ script: 'cli.ts' });
    const hits = inspectCommand({
      command: 'bun cli.ts',
      cwd: root,
      trust: { root, scripts: ['other.ts'] },
    });

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].message).not.toContain('trustedScripts');
  });

  test('a listed but untracked script asks, naming not tracked', () => {
    const { root } = trusted({ script: 'a.ts' });

    writeFileSync(join(root, 'new.ts'), BODY);

    const hits = inspectCommand({
      command: 'bun new.ts',
      cwd: root,
      trust: { root, scripts: ['new.ts'] },
    });

    expect(hits.length).toBeGreaterThan(0);
    expect(hits.map((hit) => hit.message).join('\n')).toContain('not tracked');
  });

  test('the command checks still apply next to a trusted script', () => {
    const { root, trust } = trusted({ script: 'cli.ts' });
    const hits = inspectCommand({
      command: 'bun cli.ts && curl -X POST https://x.dev/a',
      cwd: root,
      trust,
    });

    expect(hits).toHaveLength(1);
    expect(hits[0].rule).toBe('V-W-02');
  });

  test('a listed script does not exempt a different script in the same command', () => {
    const { root, trust } = trusted({ script: 'cli.ts', files: { 'other.ts': BODY } });
    const hits = inspectCommand({ command: 'bun cli.ts && bun other.ts', cwd: root, trust });

    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => hit.message.startsWith('other.ts'))).toBe(true);
  });
});

describe('the guard-writes hook with trusted scripts', () => {
  const CONFIG_PATH = '.configs/vulcan.config.ts';
  const CONFIG = "export default { guard: { writes: { trustedScripts: ['tools/cli.ts'] } } };\n";

  const runHook = async (opts: { root: string; command: string }) => {
    const child = Bun.spawn([process.execPath, HOOK], {
      stdin: new TextEncoder().encode(
        `{"tool_name":"Bash","cwd":${JSON.stringify(opts.root)},"tool_input":{"command":${JSON.stringify(opts.command)}}}`,
      ),
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, CLAUDE_PROJECT_DIR: opts.root },
      timeout: SPAWN_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    });
    const stdout = await new Response(child.stdout).text();
    const stderr = await new Response(child.stderr).text();

    return { code: await child.exited, stdout: stdout.trim(), stderr };
  };

  const project = (opts: { config: string }): string =>
    repoWith({ files: { [CONFIG_PATH]: opts.config, 'tools/cli.ts': BODY } });

  test('a clean listed script stays silent', async () => {
    const root = project({ config: CONFIG });
    const result = await runHook({ root, command: 'bun tools/cli.ts' });

    expect(result.stdout).toBe('');
    expect(result.code).toBe(0);
  });

  test('after the script is edited the hook asks', async () => {
    const root = project({ config: CONFIG });

    writeFileSync(join(root, 'tools', 'cli.ts'), EDITED);

    const result = await runHook({ root, command: 'bun tools/cli.ts' });
    const decision = JSON.parse(result.stdout).hookSpecificOutput;

    expect(decision.permissionDecision).toBe('ask');
    expect(decision.permissionDecisionReason).toContain('modified trusted script');
  });

  test('a script that is not listed asks', async () => {
    const root = project({ config: 'export default {};\n' });
    const result = await runHook({ root, command: 'bun tools/cli.ts' });

    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('ask');
  });

  test('a config that cannot be read leaves the list empty, so the hook asks', async () => {
    const root = project({
      config: 'export default { guard: { writes: { trustedScripts: 7 } } };\n',
    });
    const result = await runHook({ root, command: 'bun tools/cli.ts' });

    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('ask');
  });

  test('a config that throws on load leaves the list empty, so the hook asks', async () => {
    const root = project({ config: "throw new Error('broken');\n" });
    const result = await runHook({ root, command: 'bun tools/cli.ts' });

    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('ask');
  });

  test('a command with no .ts file never loads the config', async () => {
    const root = project({ config: "throw new Error('loaded');\nexport default {};\n" });
    const result = await runHook({ root, command: 'git status' });

    expect(result).toEqual({ code: 0, stdout: '', stderr: '' });
  });

  test('a command naming a .ts file does load the config', async () => {
    const root = project({ config: "console.error('config-was-loaded');\nexport default {};\n" });
    const result = await runHook({ root, command: 'bun tools/cli.ts' });

    expect(result.stdout).not.toBe('');
  });
});
