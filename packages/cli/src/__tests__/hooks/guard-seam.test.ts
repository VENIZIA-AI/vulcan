import { afterAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { SPAWN_TIMEOUT_MS } from '@venizia/dev-configs/testing';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const HOOKS = join(import.meta.dir, '..', '..', '..', 'base', 'hooks');
const GUARDS = ['guard-writes', 'guard-git', 'guard-outside', 'guard-remote-hosts'] as const;

type TGuard = (typeof GUARDS)[number];

const root = createProject({
  files: {
    '.agents/vulcan.manifest.json': JSON.stringify({ remoteHosts: { trusted: [], readOnly: [] } }),
  },
});

/** The real hook, run as the host runs it: its exit code and the decision it printed ('' when silent). */
const runGuard = async (opts: { guard: TGuard; command: string }) => {
  const child = Bun.spawn([process.execPath, join(HOOKS, `${opts.guard}.ts`)], {
    cwd: root,
    stdin: new TextEncoder().encode(
      `{"tool_name":"Bash","tool_input":{"command":${JSON.stringify(opts.command)}},"cwd":${JSON.stringify(root)}}`,
    ),
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, TMPDIR: join(root, '.agents/local/tmp') },
    timeout: SPAWN_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  });
  const result = await new Response(child.stdout).text();
  const stdout = result.trim();
  const code = await child.exited;
  const decision = stdout === '' ? '' : JSON.parse(stdout).hookSpecificOutput.permissionDecision;

  return { code, decision: String(decision) };
};

// One command per guard, each of which the guard must not let through: the guard's own domain (a deploy,
// a force push, a write outside the project, a host) inside `>(...)` or run through a variable.
const INSIDE_SUBSTITUTION: Record<TGuard, string> = {
  'guard-writes': 'echo x | tee >(kubectl apply -f -)',
  'guard-git': 'echo x | tee >(git push -f origin main)',
  'guard-outside': 'echo x | tee >(cat > /etc/seam-probe)',
  'guard-remote-hosts': 'echo x | tee >(ssh seam.example.invalid ls)',
};

const THROUGH_VARIABLE: Record<TGuard, string> = {
  'guard-writes': 'k=kubectl; $k apply -f x.yaml',
  'guard-git': 'g=git; $g push -f origin main',
  'guard-outside': 't=touch; $t /etc/seam-probe',
  'guard-remote-hosts': 'h=ssh; $h seam.example.invalid ls',
};

describe('every guard reads a command in a process substitution', () => {
  test.each(GUARDS)('%s asks or denies a command inside >(...)', async (guard) => {
    const result = await runGuard({ guard, command: INSIDE_SUBSTITUTION[guard] });

    expect(result.code).toBe(0);
    expect(['ask', 'deny']).toContain(result.decision);
  });

  test.each(GUARDS)('%s stays silent on a harmless >(...)', async (guard) => {
    const result = await runGuard({ guard, command: 'echo hi | tee >(cat)' });
    expect(result).toEqual({
      code: 0,
      decision: '',
    });
  });
});

describe('every guard reads a command run through a variable', () => {
  test.each(GUARDS)('%s asks or denies a variable as the program', async (guard) => {
    const result = await runGuard({ guard, command: THROUGH_VARIABLE[guard] });

    expect(result.code).toBe(0);
    expect(['ask', 'deny']).toContain(result.decision);
  });
});
