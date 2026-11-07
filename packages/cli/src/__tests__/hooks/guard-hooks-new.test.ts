import { afterAll, describe, expect, test } from 'bun:test';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createProject, removeProjects } from '../project.helper.ts';
import { GUARD_MANIFEST_FILE, guardManifest } from '../guard-manifest.helper.ts';
import { SPAWN_TIMEOUT_MS } from '@venizia/dev-configs/testing';

afterAll(removeProjects);

const HOOKS = join(import.meta.dir, '..', '..', '..', 'base', 'hooks');
/** What `vulcan sync` renders from the config below for the guards: the hooks read this. */
const MANIFEST = guardManifest({ guard: { toolOwnedPaths: ['/srv/store/**'] } });
const CONFIG =
  "export default { rules: { 'V-W-01': 'on-user-word' }, guard: { toolOwnedPaths: ['/srv/store/**'] } };\n";

const runHook = async (opts: {
  hook: string;
  stdin: string;
  root: string;
  env?: Record<string, string>;
}) => {
  const child = Bun.spawn([process.execPath, join(HOOKS, `${opts.hook}.ts`)], {
    cwd: opts.root,
    stdin: new TextEncoder().encode(opts.stdin),
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, CLAUDE_PROJECT_DIR: opts.root, ...opts.env },
    timeout: SPAWN_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  });
  const stdout = await new Response(child.stdout).text();

  const result = await child.exited;
  return { code: result, stdout: stdout.trim() };
};

const bash = (opts: { command: string; cwd: string }): string =>
  `{"tool_name":"Bash","tool_input":{"command":${JSON.stringify(opts.command)}},"cwd":${JSON.stringify(opts.cwd)}}`;

describe('the guard-git hook', () => {
  const root = createProject({ files: {} });

  test('denies deleting develop, naming V-W-06', async () => {
    const result = await runHook({
      hook: 'guard-git',
      root,
      stdin: bash({ command: 'git push origin --delete develop', cwd: root }),
    });
    const decision = JSON.parse(result.stdout).hookSpecificOutput;

    expect(result.code).toBe(0);
    expect(decision.permissionDecision).toBe('deny');
    expect(decision.permissionDecisionReason).toContain('V-W-06');
  });

  test('asks for a reset --hard', async () => {
    const result = await runHook({
      hook: 'guard-git',
      root,
      stdin: bash({ command: 'git reset --hard', cwd: root }),
    });

    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('ask');
  });

  test('asks, and never blocks, on input it cannot read', async () => {
    for (const stdin of [
      'not json',
      '[1]',
      '{"tool_name":"Bash","tool_input":{"command":5}}',
      '{"tool_name":"Bash","tool_input":{}}',
    ]) {
      const result = await runHook({ hook: 'guard-git', root, stdin });
      const decision = JSON.parse(result.stdout).hookSpecificOutput;

      expect(result.code).toBe(0);
      expect(decision.permissionDecision).toBe('ask');
      expect(decision.permissionDecisionReason).toContain('the hook input could not be read');
    }
  });

  test('is silent for a plain command, and with the kill switch on', async () => {
    const result = await runHook({
      hook: 'guard-git',
      root,
      stdin: bash({ command: 'git status', cwd: root }),
    });
    expect(result).toEqual({ code: 0, stdout: '' });
    const result3 = await runHook({
      hook: 'guard-git',
      root,
      env: { VULCAN_GUARDS: 'off' },
      stdin: bash({ command: 'git push -f origin main', cwd: root }),
    });
    expect(result3).toEqual({ code: 0, stdout: '' });
  });
});

describe('the guard-scripting hook', () => {
  const root = createProject({ files: {} });
  const adviceFor = async (command: string): Promise<{ code: number; stdout: string }> =>
    runHook({ hook: 'guard-scripting', root, stdin: bash({ command, cwd: root }) });

  test.each([
    'python3 fix.py',
    'python -c "print(1)"',
    'python3.12 -m venv .venv',
    'pip install requests',
    'pip3 install x',
    'cd src && python3 build.py',
    'cat a | python3 -c "import sys"',
    'FOO=1 python3 x.py',
    'sudo python3 x.py',
    'env -S "python3 x.py"',
    '/usr/bin/python3 x.py',
    'sh -c "python3 x.py"',
  ])('adds the advice for %s, and never asks or denies', async (command) => {
    const result = await adviceFor(command);
    const output = JSON.parse(result.stdout).hookSpecificOutput;

    expect(result.code).toBe(0);
    expect(output.hookEventName).toBe('PreToolUse');
    expect(output.additionalContext).toContain('V-B-09');
    expect(output.additionalContext).toContain('fine when the task needs it');
    expect(output.permissionDecision).toBeUndefined();
  });

  test.each([
    'ls -la',
    'bun -e "console.log(1)"',
    'bun x --no-install vulcan doctor',
    'echo python3',
    'git commit -m "replace the python script with bun"',
    'grep -rn python3 packages',
    'cat <<EOF\npython3 x.py\nEOF',
    'ls pythonic',
    'command -v python3',
    'command -v python3 >/dev/null && echo yes',
    'pipx --version',
    'bun add pip-tools',
  ])('is silent for %s: a mention is not a run', async (command) => {
    const result = await adviceFor(command);
    expect(result).toEqual({ code: 0, stdout: '' });
  });

  test('is silent for input it cannot read, and with the kill switch on', async () => {
    const result = await runHook({ hook: 'guard-scripting', root, stdin: 'not json' });
    expect(result).toEqual({
      code: 0,
      stdout: '',
    });
    const result2 = await runHook({
      hook: 'guard-scripting',
      root,
      env: { VULCAN_GUARDS: 'off' },
      stdin: bash({ command: 'python3 x.py', cwd: root }),
    });
    expect(result2).toEqual({ code: 0, stdout: '' });
  });
});

describe('the guard-outside hook', () => {
  const root = createProject({
    files: { '.configs/vulcan.config.mts': CONFIG, [GUARD_MANIFEST_FILE]: MANIFEST },
  });

  test('asks, naming the path and V-B-08, for a write outside the project', async () => {
    const result = await runHook({
      hook: 'guard-outside',
      root,
      stdin: bash({ command: 'mkdir /var/tmp/vulcan-outside-test', cwd: root }),
    });
    const decision = JSON.parse(result.stdout).hookSpecificOutput;

    expect(decision.permissionDecision).toBe('ask');
    expect(decision.permissionDecisionReason).toContain('V-B-08');
    expect(decision.permissionDecisionReason).toContain('/var/tmp/vulcan-outside-test');
  });

  test('denies, naming V-B-08 and the place to use, a write into the agent tool scratchpad', async () => {
    const result = await runHook({
      hook: 'guard-outside',
      root,
      stdin: bash({
        command: 'cd /tmp/claude-1000/-home-user-project/0b1c2d3e/scratchpad && echo x > out.ts',
        cwd: root,
      }),
    });
    const decision = JSON.parse(result.stdout).hookSpecificOutput;

    expect(result.code).toBe(0);
    expect(decision.permissionDecision).toBe('deny');
    expect(decision.permissionDecisionReason).toContain('V-B-08');
    expect(decision.permissionDecisionReason).toContain('scratchpad');
    expect(decision.permissionDecisionReason).toContain('.agents/local/tmp/');
  });

  test('a deny wins when one call touches the scratchpad and another outside path', async () => {
    const result = await runHook({
      hook: 'guard-outside',
      root,
      stdin: bash({
        command: 'mkdir /var/tmp/vulcan-outside-test && touch /tmp/claude-1000/p/s/scratchpad/a',
        cwd: root,
      }),
    });

    const decision = JSON.parse(result.stdout).hookSpecificOutput;

    expect(decision.permissionDecision).toBe('deny');
    expect(decision.permissionDecisionReason).toContain('/var/tmp/vulcan-outside-test');
    expect(decision.permissionDecisionReason).toContain('/tmp/claude-1000/p/s/scratchpad/a');
  });

  test('allows a path the project config lists in guard.toolOwnedPaths', async () => {
    const result = await runHook({
      hook: 'guard-outside',
      root,
      stdin: bash({ command: 'touch /srv/store/a.bin', cwd: root }),
    });

    expect(result).toEqual({ code: 0, stdout: '' });
  });

  test('asks, and never blocks, on input it cannot read', async () => {
    for (const stdin of ['not json', '[1]', '{"tool_input":{"command":"ls"}}']) {
      const result = await runHook({ hook: 'guard-outside', root, stdin });
      const decision = JSON.parse(result.stdout).hookSpecificOutput;

      expect(result.code).toBe(0);
      expect(decision.permissionDecision).toBe('ask');
      expect(decision.permissionDecisionReason).toContain('hook input could not be read');
    }
  });

  test('is silent inside the project, and with the kill switch on', async () => {
    const result = await runHook({
      hook: 'guard-outside',
      root,
      stdin: bash({ command: 'mkdir -p .agents/local/tmp/x', cwd: root }),
    });
    expect(result).toEqual({ code: 0, stdout: '' });
    const result3 = await runHook({
      hook: 'guard-outside',
      root,
      env: { VULCAN_GUARDS: 'off' },
      stdin: bash({ command: 'mkdir /var/tmp/x', cwd: root }),
    });
    expect(result3).toEqual({ code: 0, stdout: '' });
  });
});

describe('the guard-outside hook with guard.outside set', () => {
  const configOf = (opts: { outside: string }) =>
    `export default { rules: { 'V-W-01': 'on-user-word' }, guard: { outside: '${opts.outside}', toolOwnedPaths: ['/srv/store/**'] } };\n`;
  const manifestOf = (opts: { outside: string }) =>
    guardManifest({ guard: { outside: opts.outside, toolOwnedPaths: ['/srv/store/**'] } });
  const denyRoot = createProject({
    files: {
      '.configs/vulcan.config.mts': configOf({ outside: 'deny' }),
      [GUARD_MANIFEST_FILE]: manifestOf({ outside: 'deny' }),
    },
  });
  const askRoot = createProject({
    files: {
      '.configs/vulcan.config.mts': configOf({ outside: 'ask' }),
      [GUARD_MANIFEST_FILE]: manifestOf({ outside: 'ask' }),
    },
  });
  const brokenRoot = createProject({
    files: {
      '.configs/vulcan.config.mts': configOf({ outside: 'maybe' }),
      [GUARD_MANIFEST_FILE]: manifestOf({ outside: 'maybe' }),
    },
  });

  test('deny refuses a write outside the project, naming V-B-08, the path and the place to use', async () => {
    const result = await runHook({
      hook: 'guard-outside',
      root: denyRoot,
      stdin: bash({ command: 'echo x > /var/tmp/vulcan-outside-test', cwd: denyRoot }),
    });
    const decision = JSON.parse(result.stdout).hookSpecificOutput;

    expect(result.code).toBe(0);
    expect(decision.permissionDecision).toBe('deny');
    expect(decision.permissionDecisionReason).toContain('V-B-08');
    expect(decision.permissionDecisionReason).toContain('/var/tmp/vulcan-outside-test');
    expect(decision.permissionDecisionReason).toContain('.agents/local/tmp/');
    expect(decision.permissionDecisionReason).toContain('guard.toolOwnedPaths');
    expect(decision.permissionDecisionReason).toContain('Nothing was written');
    expect(decision.permissionDecisionReason).not.toContain('confirm only if');
  });

  test('ask keeps asking, the same as no setting', async () => {
    const result = await runHook({
      hook: 'guard-outside',
      root: askRoot,
      stdin: bash({ command: 'echo x > /var/tmp/vulcan-outside-test', cwd: askRoot }),
    });

    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('ask');
  });

  test('a store listed in guard.toolOwnedPaths and a write inside the project still pass', async () => {
    const listed = await runHook({
      hook: 'guard-outside',
      root: denyRoot,
      stdin: bash({ command: 'touch /srv/store/a.bin', cwd: denyRoot }),
    });
    const inside = await runHook({
      hook: 'guard-outside',
      root: denyRoot,
      stdin: bash({ command: 'mkdir -p .agents/local/tmp/x', cwd: denyRoot }),
    });

    expect(listed).toEqual({ code: 0, stdout: '' });
    expect(inside).toEqual({ code: 0, stdout: '' });
  });

  const fileTool = (opts: { tool: string; path: string; cwd: string }): string =>
    JSON.stringify(
      Object.fromEntries([
        ['tool_name', opts.tool],
        ['tool_input', Object.fromEntries([['file_path', opts.path]])],
        ['cwd', opts.cwd],
      ]),
    );

  test.each(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])(
    'deny refuses a %s outside the project, and one inside passes',
    async (tool) => {
      const outside = await runHook({
        hook: 'guard-outside',
        root: denyRoot,
        stdin: fileTool({ tool, path: '/var/tmp/vulcan-outside-test.md', cwd: denyRoot }),
      });
      const inside = await runHook({
        hook: 'guard-outside',
        root: denyRoot,
        stdin: fileTool({ tool, path: join(denyRoot, 'docs', 'a.md'), cwd: denyRoot }),
      });
      const decision = JSON.parse(outside.stdout).hookSpecificOutput;

      expect(decision.permissionDecision).toBe('deny');
      expect(decision.permissionDecisionReason).toContain('/var/tmp/vulcan-outside-test.md');
      expect(inside).toEqual({ code: 0, stdout: '' });
    },
  );

  test('deny with the scratchpad: still one deny, and it names the scratchpad and the other path', async () => {
    const result = await runHook({
      hook: 'guard-outside',
      root: denyRoot,
      stdin: bash({
        command: 'mkdir /var/tmp/vulcan-outside-test && touch /tmp/claude-1000/p/s/scratchpad/a',
        cwd: denyRoot,
      }),
    });
    const decision = JSON.parse(result.stdout).hookSpecificOutput;

    expect(decision.permissionDecision).toBe('deny');
    expect(decision.permissionDecisionReason).toContain('scratchpad');
    expect(decision.permissionDecisionReason).toContain('/var/tmp/vulcan-outside-test');
    expect(decision.permissionDecisionReason).toContain('/tmp/claude-1000/p/s/scratchpad/a');
  });

  test('a key this VULCAN does not know in the config changes nothing: the synced deny still denies', async () => {
    const typoRoot = createProject({
      files: {
        '.configs/vulcan.config.mts':
          "export default { rules: { 'V-W-01': 'on-user-word' }, guard: { outside: 'deny', notAKey: true } };\n",
        [GUARD_MANIFEST_FILE]: guardManifest({ guard: { outside: 'deny' } }),
      },
    });
    const result = await runHook({
      hook: 'guard-outside',
      root: typoRoot,
      stdin: bash({ command: 'echo x > /var/tmp/vulcan-outside-test', cwd: typoRoot }),
    });

    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
  });

  test('a value of the manifest that is not deny reads as ask', async () => {
    const result = await runHook({
      hook: 'guard-outside',
      root: brokenRoot,
      stdin: bash({ command: 'echo x > /var/tmp/vulcan-outside-test', cwd: brokenRoot }),
    });

    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('ask');
  });
});

describe('the subagent-start hook', () => {
  const root = createProject({
    files: { '.configs/vulcan.config.mts': CONFIG, '.agents/rules.md': '# r\n' },
  });

  test('adds the small subagent card as context: the gates, not the digest or the project table', async () => {
    const result = await runHook({
      hook: 'subagent-start',
      root,
      stdin: '{"hook_event_name":"SubagentStart","agent_type":"general-purpose","agent_id":"a1"}',
    });
    const output = JSON.parse(result.stdout).hookSpecificOutput;

    expect(result.code).toBe(0);
    expect(output.hookEventName).toBe('SubagentStart');
    expect(output.additionalContext).toContain('V-B-08');
    expect(output.additionalContext).toContain('No git writes');
    expect(output.additionalContext.length).toBeLessThanOrEqual(1600);
    expect(output.additionalContext).not.toContain('The rules sessions drop most');
    expect(output.additionalContext).not.toContain("This project's own rules\n");
  });
});

describe('the kill switch does not depend on the install being healthy', () => {
  test.each(['guard-git', 'guard-scripting', 'guard-outside'])(
    '%s: with its modules unloadable it says so (guard-outside asks); with VULCAN_GUARDS=off it is silent',
    async (hook) => {
      // A copy of the hook where `../../src/hooks/*` does not exist: the import fails.
      const broken = join(createProject({ files: {} }), 'a', 'b');

      mkdirSync(broken, { recursive: true });
      copyFileSync(join(HOOKS, `${hook}.ts`), join(broken, `${hook}.ts`));

      const run = async (env: Record<string, string>) => {
        const child = Bun.spawn([process.execPath, join(broken, `${hook}.ts`)], {
          stdin: new TextEncoder().encode(bash({ command: 'ls', cwd: broken })),
          stdout: 'pipe',
          stderr: 'pipe',
          env: { ...process.env, ...env },
          timeout: SPAWN_TIMEOUT_MS,
          killSignal: 'SIGKILL',
        });
        const stderr = await new Response(child.stderr).text();
        const stdout = await new Response(child.stdout).text();

        const result = await child.exited;
        return { code: result, stderr, stdout };
      };
      const failing = await run({});
      const off = await run({ VULCAN_GUARDS: 'off' });

      expect(failing.code).toBe(0);
      expect(failing.stderr).toContain(`the ${hook} hook failed`);
      // guard-outside asks about every call it could not check; guard-git only about git and gh; the advice hook stays silent.
      expect(failing.stdout.includes('"permissionDecision":"ask"')).toBe(hook === 'guard-outside');
      expect(off).toEqual({ code: 0, stderr: '', stdout: '' });
    },
  );
});
