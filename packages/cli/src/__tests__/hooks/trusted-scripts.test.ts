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

// A release script with a read-only subcommand and a publishing one: the file holds a POST, so it is flagged as a whole.
const RELEASE = [
  'const [command] = Bun.argv.slice(2);',
  "if (command === 'plan') console.log('matrix');",
  "if (command === 'registry') console.log('lookup');",
  "if (command === 'run') await fetch(url, { method: 'POST' });",
  'export {};',
  '',
].join('\n');
const RELEASE_PATH = 'tools/release.ts';
const READ_ONLY = [{ script: RELEASE_PATH, readOnly: ['plan', 'registry'] }];

describe('inspectCommand with read-only subcommands', () => {
  const release = (opts: { files?: Record<string, string> } = {}) => {
    const root = repoWith({ files: { [RELEASE_PATH]: RELEASE, ...opts.files } });

    return { root, trust: { root, scripts: [], readOnlyScripts: READ_ONLY } };
  };

  test('the script is flagged without the entry: the file holds a POST', () => {
    const { root } = release();

    expect(
      inspectCommand({ command: `bun ${RELEASE_PATH} plan`, cwd: root }).length,
    ).toBeGreaterThan(0);
  });

  test.each([
    `bun ${RELEASE_PATH} plan`,
    `bun ${RELEASE_PATH} registry packages/a/package.json`,
    `bun run ${RELEASE_PATH} plan`,
    `bun ./${RELEASE_PATH} plan --json`,
    `bun ${RELEASE_PATH} plan > plan.txt`,
    `bun ${RELEASE_PATH} plan; echo done`,
    `GITHUB_OUTPUT=out.txt bun ${RELEASE_PATH} plan`,
  ])('a listed subcommand is quiet: %s', (command) => {
    const { root, trust } = release();

    expect(inspectCommand({ command, cwd: root, trust })).toEqual([]);
  });

  test('an absolute path and a call from a subfolder are quiet too', () => {
    const { root, trust } = release({ files: { 'sub/keep.txt': 'x' } });

    expect(
      inspectCommand({ command: `bun ${join(root, RELEASE_PATH)} plan`, cwd: '/', trust }),
    ).toEqual([]);
    expect(
      inspectCommand({ command: 'bun ../tools/release.ts plan', cwd: join(root, 'sub'), trust }),
    ).toEqual([]);
  });

  test('the run subcommand of the same script still asks, as it does with no entry', () => {
    const { root, trust } = release();
    const withEntry = inspectCommand({ command: `bun ${RELEASE_PATH} run`, cwd: root, trust });
    const without = inspectCommand({ command: `bun ${RELEASE_PATH} run`, cwd: root });

    expect(withEntry.length).toBeGreaterThan(0);
    expect(withEntry).toEqual(without);
    expect(withEntry.map((hit) => hit.message).join('\n')).not.toContain('trustedScripts');
  });

  test.each([
    ['no subcommand', `bun ${RELEASE_PATH}`],
    ['a flag only', `bun ${RELEASE_PATH} --help`],
    ['a flag before the subcommand', `bun ${RELEASE_PATH} --dry-run plan`],
    ['a longer word', `bun ${RELEASE_PATH} plan-all`],
    ['a prefix of a listed word', `bun ${RELEASE_PATH} pla`],
    ['another case', `bun ${RELEASE_PATH} PLAN`],
    ['a word that holds the subcommand and more', `bun ${RELEASE_PATH} "plan x"`],
    ['an equals form', `bun ${RELEASE_PATH} plan=1`],
    ['a separator stuck to the word', `bun ${RELEASE_PATH} "plan;"`],
    ['a subcommand from a variable', `bun ${RELEASE_PATH} $SUBCOMMAND`],
    ['the subcommand after another word', `bun ${RELEASE_PATH} run plan`],
  ])('asks for %s', (_name, command) => {
    const { root, trust } = release();

    expect(inspectCommand({ command, cwd: root, trust }).length).toBeGreaterThan(0);
  });

  test.each([
    ['a semicolon', `bun ${RELEASE_PATH} plan; bun ${RELEASE_PATH} run`],
    ['and', `bun ${RELEASE_PATH} plan && bun ${RELEASE_PATH} run`],
    ['or', `bun ${RELEASE_PATH} plan || bun ${RELEASE_PATH} run`],
    ['a pipe', `bun ${RELEASE_PATH} plan | bun ${RELEASE_PATH} run`],
    ['run first', `bun ${RELEASE_PATH} run; bun ${RELEASE_PATH} plan`],
    ['a subshell', `(bun ${RELEASE_PATH} plan; bun ${RELEASE_PATH} run)`],
    ['a newline', `bun ${RELEASE_PATH} plan\nbun ${RELEASE_PATH} run`],
  ])('a compound command with %s judges each command on its own', (_name, command) => {
    const { root, trust } = release();
    const hits = inspectCommand({ command, cwd: root, trust });
    const runOnly = inspectCommand({ command: `bun ${RELEASE_PATH} run`, cwd: root });

    expect(hits).toEqual(runOnly);
  });

  test('a compound command of two listed subcommands is quiet', () => {
    const { root, trust } = release();

    expect(
      inspectCommand({
        command: `bun ${RELEASE_PATH} plan && bun ${RELEASE_PATH} registry a.json`,
        cwd: root,
        trust,
      }),
    ).toEqual([]);
  });

  test('a listed call that carries another call of the script in its arguments asks', () => {
    const { root, trust } = release();

    expect(
      inspectCommand({
        command: `bun ${RELEASE_PATH} plan "bun ${RELEASE_PATH} run"`,
        cwd: root,
        trust,
      }).length,
    ).toBeGreaterThan(0);
    expect(
      inspectCommand({
        command: `bun ${RELEASE_PATH} plan; bun ${RELEASE_PATH} "plan x"`,
        cwd: root,
        trust,
      }).length,
    ).toBeGreaterThan(0);
  });

  test('a pipe into the script, then a publishing call, asks', () => {
    const { root, trust } = release();

    expect(
      inspectCommand({
        command: `echo x | bun ${RELEASE_PATH} plan; bun ${RELEASE_PATH} run`,
        cwd: root,
        trust,
      }).length,
    ).toBeGreaterThan(0);
  });

  test('the command line is still checked next to a listed subcommand', () => {
    const { root, trust } = release();
    const hits = inspectCommand({
      command: `bun ${RELEASE_PATH} plan && curl -X POST https://x.dev/a`,
      cwd: root,
      trust,
    });

    expect(hits).toHaveLength(1);
    expect(hits[0].rule).toBe('V-W-02');
    expect(hits[0].message).toContain('calling an endpoint');
  });

  test('a listed subcommand of an edited script asks, saying modified trusted script', () => {
    const { root, trust } = release();

    writeFileSync(join(root, RELEASE_PATH), `${RELEASE}// edited\n`);

    const hits = inspectCommand({ command: `bun ${RELEASE_PATH} plan`, cwd: root, trust });
    const text = hits.map((hit) => hit.message).join('\n');

    expect(hits.length).toBeGreaterThan(0);
    expect(text).toContain('listed in guard.writes.trustedScripts');
    expect(text).toContain('modified trusted script');
  });

  test('an untracked or uncommitted script is checked like any other', () => {
    const { root } = release();

    writeFileSync(join(root, 'tools', 'new.ts'), RELEASE);

    const untracked = inspectCommand({
      command: 'bun tools/new.ts plan',
      cwd: root,
      trust: {
        root,
        scripts: [],
        readOnlyScripts: [{ script: 'tools/new.ts', readOnly: ['plan'] }],
      },
    });

    expect(untracked.map((hit) => hit.message).join('\n')).toContain('not tracked');

    git({ cwd: root, args: ['add', 'tools/new.ts'] });

    const staged = inspectCommand({
      command: 'bun tools/new.ts plan',
      cwd: root,
      trust: {
        root,
        scripts: [],
        readOnlyScripts: [{ script: 'tools/new.ts', readOnly: ['plan'] }],
      },
    });

    expect(staged.map((hit) => hit.message).join('\n')).toContain('not in the last commit');
  });

  test('a subcommand listed for one script does not open another script', () => {
    const { root, trust } = release({ files: { 'tools/other.ts': RELEASE } });

    expect(
      inspectCommand({ command: 'bun tools/other.ts plan', cwd: root, trust }).length,
    ).toBeGreaterThan(0);
  });

  test('a subcommand listed for another script does not open this one', () => {
    const { root } = release();
    const trust = {
      root,
      scripts: [],
      readOnlyScripts: [{ script: RELEASE_PATH, readOnly: ['registry'] }],
    };

    expect(
      inspectCommand({ command: `bun ${RELEASE_PATH} plan`, cwd: root, trust }).length,
    ).toBeGreaterThan(0);
  });

  test('a path string entry behaves as before: every subcommand of the script is quiet', () => {
    const { root } = release();
    const trust = { root, scripts: [RELEASE_PATH] };

    for (const command of [
      `bun ${RELEASE_PATH} plan`,
      `bun ${RELEASE_PATH} run`,
      `bun ${RELEASE_PATH}`,
    ]) {
      expect(inspectCommand({ command, cwd: root, trust })).toEqual([]);
    }
  });

  test('a path string entry wins over an object entry for the same script', () => {
    const { root } = release();
    const trust = { root, scripts: [RELEASE_PATH], readOnlyScripts: READ_ONLY };

    expect(inspectCommand({ command: `bun ${RELEASE_PATH} run`, cwd: root, trust })).toEqual([]);
  });

  test('no readOnly entries and an empty list change nothing', () => {
    const { root } = release();

    for (const trust of [
      { root, scripts: [] },
      { root, scripts: [], readOnlyScripts: [] },
    ]) {
      expect(
        inspectCommand({ command: `bun ${RELEASE_PATH} plan`, cwd: root, trust }).length,
      ).toBeGreaterThan(0);
    }
  });
});

describe('the guard-writes hook with read-only subcommands', () => {
  const MANIFEST_PATH = '.agents/vulcan.manifest.json';
  const manifestOf = (opts: { readOnlyScripts: unknown }): string =>
    JSON.stringify({
      schemaVersion: 1,
      guard: { writes: { readOnlyScripts: opts.readOnlyScripts } },
    });

  const runHook = (opts: { root: string; command: string }) => {
    const child = Bun.spawnSync([process.execPath, HOOK], {
      stdin: new TextEncoder().encode(
        JSON.stringify(
          Object.fromEntries([
            ['tool_name', 'Bash'],
            ['tool_input', { command: opts.command }],
            ['cwd', opts.root],
          ]),
        ),
      ),
      env: { ...process.env, CLAUDE_PROJECT_DIR: opts.root },
      timeout: SPAWN_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    });

    return {
      code: child.exitCode,
      stdout: child.stdout.toString().trim(),
      stderr: child.stderr.toString(),
    };
  };

  const project = (opts: { manifest?: string }) =>
    repoWith({
      files: {
        [RELEASE_PATH]: RELEASE,
        ...(opts.manifest === undefined ? {} : { [MANIFEST_PATH]: opts.manifest }),
      },
    });

  test('a listed subcommand stays silent and run asks', () => {
    const root = project({ manifest: manifestOf({ readOnlyScripts: READ_ONLY }) });
    const plan = runHook({ root, command: `bun ${RELEASE_PATH} plan` });
    const registry = runHook({ root, command: `bun ${RELEASE_PATH} registry a.json` });
    const run = runHook({ root, command: `bun ${RELEASE_PATH} run` });

    expect(plan).toEqual({ code: 0, stdout: '', stderr: '' });
    expect(registry).toEqual({ code: 0, stdout: '', stderr: '' });
    expect(JSON.parse(run.stdout).hookSpecificOutput.permissionDecision).toBe('ask');
  });

  test('a compound command asks for the publishing call only', () => {
    const root = project({ manifest: manifestOf({ readOnlyScripts: READ_ONLY }) });
    const result = runHook({
      root,
      command: `bun ${RELEASE_PATH} plan && bun ${RELEASE_PATH} run`,
    });

    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('ask');
  });

  test('after the script is edited the hook asks even for a listed subcommand', () => {
    const root = project({ manifest: manifestOf({ readOnlyScripts: READ_ONLY }) });

    writeFileSync(join(root, RELEASE_PATH), `${RELEASE}// edited\n`);

    const decision = JSON.parse(
      runHook({ root, command: `bun ${RELEASE_PATH} plan` }).stdout,
    ).hookSpecificOutput;

    expect(decision.permissionDecision).toBe('ask');
    expect(decision.permissionDecisionReason).toContain('modified trusted script');
  });

  test('a project with no manifest, or one that lists none, asks as before', () => {
    for (const manifest of [undefined, manifestOf({ readOnlyScripts: [] }), '{ nope']) {
      const root = project({ manifest });
      const result = runHook({ root, command: `bun ${RELEASE_PATH} plan` });

      expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('ask');
    }
  });

  test('an entry of the manifest that is not usable is skipped, said once, and the others stay', () => {
    const root = project({
      manifest: manifestOf({
        readOnlyScripts: [
          { script: RELEASE_PATH },
          { script: 7, readOnly: ['plan'] },
          { script: RELEASE_PATH, readOnly: ['plan', 3, ''] },
          'tools/other.ts',
          ...READ_ONLY,
        ],
      }),
    });
    const result = runHook({ root, command: `bun ${RELEASE_PATH} plan` });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr.match(/readOnlyScripts/g)).toHaveLength(4);
  });

  test('a path string in the config still trusts every subcommand', () => {
    const root = repoWith({
      files: {
        [RELEASE_PATH]: RELEASE,
        '.configs/vulcan.config.ts': `export default { guard: { writes: { trustedScripts: ['${RELEASE_PATH}'] } } };\n`,
      },
    });

    expect(runHook({ root, command: `bun ${RELEASE_PATH} run` }).stdout).toBe('');
  });

  test('an object entry in the config alone is not read by the hook before a sync: it asks', () => {
    const root = repoWith({
      files: {
        [RELEASE_PATH]: RELEASE,
        '.configs/vulcan.config.ts': `export default { guard: { writes: { trustedScripts: [{ script: '${RELEASE_PATH}', readOnly: ['plan'] }] } } };\n`,
      },
    });
    const result = runHook({ root, command: `bun ${RELEASE_PATH} plan` });

    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('ask');
  });
});
