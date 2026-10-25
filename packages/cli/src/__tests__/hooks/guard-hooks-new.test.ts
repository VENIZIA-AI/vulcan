import { afterAll, describe, expect, test } from 'bun:test';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createProject, removeProjects } from '../project.helper.ts';
import { SPAWN_TIMEOUT_MS } from '../spawn.helper.ts';

afterAll(removeProjects);

const HOOKS = join(import.meta.dir, '..', '..', '..', 'base', 'hooks');
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

  return { code: await child.exited, stdout: stdout.trim() };
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

  test('is silent for a plain command, for input it cannot read, and with the kill switch on', async () => {
    expect(
      await runHook({ hook: 'guard-git', root, stdin: bash({ command: 'git status', cwd: root }) }),
    ).toEqual({ code: 0, stdout: '' });
    expect(await runHook({ hook: 'guard-git', root, stdin: 'not json' })).toEqual({
      code: 0,
      stdout: '',
    });
    expect(
      await runHook({
        hook: 'guard-git',
        root,
        env: { VULCAN_GUARDS: 'off' },
        stdin: bash({ command: 'git push -f origin main', cwd: root }),
      }),
    ).toEqual({ code: 0, stdout: '' });
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
    expect(await adviceFor(command)).toEqual({ code: 0, stdout: '' });
  });

  test('is silent for input it cannot read, and with the kill switch on', async () => {
    expect(await runHook({ hook: 'guard-scripting', root, stdin: 'not json' })).toEqual({
      code: 0,
      stdout: '',
    });
    expect(
      await runHook({
        hook: 'guard-scripting',
        root,
        env: { VULCAN_GUARDS: 'off' },
        stdin: bash({ command: 'python3 x.py', cwd: root }),
      }),
    ).toEqual({ code: 0, stdout: '' });
  });
});

describe('the guard-outside hook', () => {
  const root = createProject({ files: { '.configs/vulcan.config.ts': CONFIG } });

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

  test('allows a path the project config lists in guard.toolOwnedPaths', async () => {
    const result = await runHook({
      hook: 'guard-outside',
      root,
      stdin: bash({ command: 'touch /srv/store/a.bin', cwd: root }),
    });

    expect(result).toEqual({ code: 0, stdout: '' });
  });

  test('is silent inside the project, for input it cannot read, and with the kill switch on', async () => {
    expect(
      await runHook({
        hook: 'guard-outside',
        root,
        stdin: bash({ command: 'mkdir -p .agents/local/tmp/x', cwd: root }),
      }),
    ).toEqual({ code: 0, stdout: '' });
    expect(await runHook({ hook: 'guard-outside', root, stdin: 'not json' })).toEqual({
      code: 0,
      stdout: '',
    });
    expect(
      await runHook({
        hook: 'guard-outside',
        root,
        env: { VULCAN_GUARDS: 'off' },
        stdin: bash({ command: 'mkdir /var/tmp/x', cwd: root }),
      }),
    ).toEqual({ code: 0, stdout: '' });
  });
});

describe('the subagent-start hook', () => {
  const root = createProject({
    files: { '.configs/vulcan.config.ts': CONFIG, '.agents/rules.md': '# r\n' },
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
    '%s: with its modules unloadable it passes the call and says so; with VULCAN_GUARDS=off it is silent',
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

        return { code: await child.exited, stderr };
      };
      const failing = await run({});
      const off = await run({ VULCAN_GUARDS: 'off' });

      expect(failing.code).toBe(0);
      expect(failing.stderr).toContain('the call passes');
      expect(off).toEqual({ code: 0, stderr: '' });
    },
  );
});
