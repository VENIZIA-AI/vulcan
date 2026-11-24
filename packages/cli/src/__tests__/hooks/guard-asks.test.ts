import { afterAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';
import { GUARD_MANIFEST_FILE, guardManifest } from '../guard-manifest.helper.ts';
import { fileToolEvent } from '../hook-event.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const HOOKS = join(import.meta.dir, '..', '..', '..', 'base', 'hooks');

type THook = 'guard-writes' | 'guard-git' | 'guard-outside';

/** Every source of an ask the Claude Code hooks have, with what the project must set for it to fire. */
interface IAskSource {
  name: string;
  hook: THook;
  command: string;
  /** The project's own guard block, besides `asks`. */
  guard?: Record<string, unknown>;
  /** A git repository with a branch that is not merged into the current one. */
  isRepository?: boolean;
}

const SOURCES: IAskSource[] = [
  {
    name: 'a deploy of the writes table (V-W-03)',
    hook: 'guard-writes',
    command: 'kubectl apply -f deploy.yaml',
  },
  {
    name: 'a database write of the writes table (V-W-02)',
    hook: 'guard-writes',
    command: 'psql -c "DROP TABLE users"',
  },
  {
    name: 'a command the project lists in guard.writes.commands',
    hook: 'guard-writes',
    command: 'make deploy-prod',
    guard: {
      writes: { commands: [{ rule: 'V-W-03', what: 'deploying', pattern: '\\bmake deploy-' }] },
    },
  },
  {
    name: 'a plain push to a branch in guard.git.askPush',
    hook: 'guard-git',
    command: 'git push origin develop',
    guard: { git: { askPush: ['develop'] } },
  },
  { name: 'git push --mirror', hook: 'guard-git', command: 'git push --mirror origin' },
  { name: 'git reset --hard', hook: 'guard-git', command: 'git reset --hard HEAD~1' },
  {
    name: 'a force-push to a branch that is not protected',
    hook: 'guard-git',
    command: 'git push --force origin feature/x',
  },
  {
    name: 'git branch -D of a branch that is not merged',
    hook: 'guard-git',
    command: 'git branch -D feature/unmerged',
    isRepository: true,
  },
  {
    name: 'a write outside the project',
    hook: 'guard-outside',
    command: 'echo x > /var/tmp/vulcan-asks-probe.txt',
  },
];

const git = (opts: { root: string; args: string[] }): void => {
  const result = spawnSyncBounded({
    cmd: ['git', '-c', 'user.name=t', '-c', 'user.email=t@example.test', ...opts.args],
    cwd: opts.root,
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (result.exitCode !== 0) {
    throw new Error(`git ${opts.args.join(' ')}: ${result.stderr.toString()}`);
  }
};

/** A project with the manifest the hooks read, and a repository when the source needs one. */
const projectOf = (opts: { guard: Record<string, unknown>; isRepository?: boolean }): string => {
  const root = createProject({
    files: { 'package.json': '{}', [GUARD_MANIFEST_FILE]: guardManifest({ guard: opts.guard }) },
  });

  if (opts.isRepository === true) {
    git({ root, args: ['init', '-q', '-b', 'main'] });
    git({ root, args: ['add', '.'] });
    git({ root, args: ['commit', '-q', '-m', 'one'] });
    git({ root, args: ['checkout', '-q', '-b', 'feature/unmerged'] });
    git({ root, args: ['commit', '-q', '--allow-empty', '-m', 'two'] });
    git({ root, args: ['checkout', '-q', 'main'] });
  }

  return root;
};

/** What a hook answers to a Bash call (or to whatever `stdin` holds), as the decision and the whole text. */
const answerOf = (opts: {
  hook: THook;
  root: string;
  command?: string;
  stdin?: string;
  env?: Record<string, string>;
}) => {
  const environment: Record<string, string | undefined> = {
    ...process.env,
    CLAUDE_PROJECT_DIR: opts.root,
  };

  // A temp folder named by these would be allowed; the sources are meant to be asked about.
  delete environment.XDG_RUNTIME_DIR;
  delete environment.VULCAN_GUARDS;
  delete environment.CURSOR_PROJECT_DIR;
  delete environment.VULCAN_GUARD_ASKS;
  delete environment.VULCAN_GUARD_OUTSIDE;
  Object.assign(environment, opts.env);

  const stdin =
    opts.stdin ??
    JSON.stringify(
      Object.fromEntries([
        ['tool_name', 'Bash'],
        ['tool_input', { command: opts.command }],
        ['cwd', opts.root],
      ]),
    );
  const result = spawnSyncBounded({
    cmd: [process.execPath, join(HOOKS, `${opts.hook}.ts`)],
    cwd: opts.root,
    env: environment,
    stdin: new Blob([stdin]),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const text = result.stdout.toString().trim();
  const parsed: unknown = text === '' ? undefined : JSON.parse(text);
  const specific =
    typeof parsed === 'object' && parsed !== null && 'hookSpecificOutput' in parsed
      ? parsed.hookSpecificOutput
      : undefined;
  const decision =
    typeof specific === 'object' && specific !== null && 'permissionDecision' in specific
      ? specific.permissionDecision
      : undefined;

  return { code: result.exitCode, decision, text };
};

describe('every ask the hooks have becomes a deny with guard.asks: deny', () => {
  test.each(SOURCES)('$name: it asks by default and denies when asks is deny', (source) => {
    const asked = answerOf({
      hook: source.hook,
      command: source.command,
      root: projectOf({ guard: { ...source.guard }, isRepository: source.isRepository }),
    });
    const kept = answerOf({
      hook: source.hook,
      command: source.command,
      root: projectOf({
        guard: { ...source.guard, asks: 'ask' },
        isRepository: source.isRepository,
      }),
    });
    const held = answerOf({
      hook: source.hook,
      command: source.command,
      root: projectOf({
        guard: { ...source.guard, asks: 'deny' },
        isRepository: source.isRepository,
      }),
    });

    expect(asked.decision).toBe('ask');
    expect(kept.decision).toBe('ask');
    expect(held.code).toBe(0);
    expect(held.decision).toBe('deny');
    expect(held.text).toContain('guard.asks');
  });

  test.each(SOURCES)(
    '$name: VULCAN_GUARD_ASKS=deny denies it, whatever the manifest says',
    (source) => {
      for (const guard of [{ ...source.guard }, { ...source.guard, asks: 'ask' }]) {
        const held = answerOf({
          hook: source.hook,
          command: source.command,
          root: projectOf({ guard, isRepository: source.isRepository }),
          env: { VULCAN_GUARD_ASKS: 'deny' },
        });

        expect(held.decision).toBe('deny');
        expect(held.text).toContain('VULCAN_GUARD_ASKS=deny');
      }
    },
  );

  test.each(['ask', 'allow', '1', 'true', 'DENY', ''])(
    'VULCAN_GUARD_ASKS=%s is not deny: an ask stays an ask',
    (value) => {
      const result = answerOf({
        hook: 'guard-git',
        command: 'git reset --hard HEAD~1',
        root: projectOf({ guard: {} }),
        env: { VULCAN_GUARD_ASKS: value },
      });

      expect(result.decision).toBe('ask');
    },
  );

  test('the manifest can only tighten: the strictest of the environment and the manifest holds', () => {
    for (const [env, asks, expected] of [
      [undefined, 'deny', 'deny'],
      [undefined, 'ask', 'ask'],
      ['deny', 'ask', 'deny'],
      ['deny', 'deny', 'deny'],
      ['ask', 'deny', 'deny'],
    ] as const) {
      const result = answerOf({
        hook: 'guard-git',
        command: 'git reset --hard HEAD~1',
        root: projectOf({ guard: { asks } }),
        env: env === undefined ? undefined : { VULCAN_GUARD_ASKS: env },
      });

      expect(result.decision, `env ${env} manifest ${asks}`).toBe(expected);
    }
  });

  test('VULCAN_GUARD_OUTSIDE=deny denies a write outside the project and leaves the other asks asking', () => {
    const root = projectOf({ guard: { outside: 'ask' } });
    const env = { VULCAN_GUARD_OUTSIDE: 'deny' };

    expect(
      answerOf({
        hook: 'guard-outside',
        command: 'echo x > /var/tmp/vulcan-asks-probe.txt',
        root,
        env,
      }).decision,
    ).toBe('deny');
    expect(
      answerOf({ hook: 'guard-git', command: 'git reset --hard HEAD~1', root, env }).decision,
    ).toBe('ask');
    expect(
      answerOf({ hook: 'guard-outside', command: 'echo x > /var/tmp/vulcan-asks-probe.txt', root })
        .decision,
    ).toBe('ask');
  });

  test('an agent cannot loosen a held project by editing the manifest: the edit is denied, and a loosened manifest does not weaken the environment', () => {
    const root = projectOf({ guard: { asks: 'deny' } });
    const edits = [
      "sed -i 's/deny/ask/' .agents/local/vulcan.manifest.json",
      'echo "{}" > .agents/local/vulcan.manifest.json',
      'rm .agents/local/vulcan.manifest.json',
      "perl -pi -e 's/deny/ask/' .agents/local/vulcan.manifest.json",
    ];

    for (const command of edits) {
      expect(answerOf({ hook: 'guard-outside', command, root }).decision, command).toBe('deny');
    }

    // The same call through the file tools.
    const written = answerOf({
      hook: 'guard-outside',
      root,
      stdin: fileToolEvent({
        tool: 'Write',
        path: join(root, '.agents', 'local', 'vulcan.manifest.json'),
        cwd: root,
      }),
    });

    expect(written.decision).toBe('deny');

    // The owner's environment holds even when the manifest is loosened by other means.
    const loosened = projectOf({ guard: { asks: 'ask' } });

    expect(
      answerOf({
        hook: 'guard-git',
        command: 'git reset --hard HEAD~1',
        root: loosened,
        env: { VULCAN_GUARD_ASKS: 'deny' },
      }).decision,
    ).toBe('deny');
    expect(
      answerOf({
        hook: 'guard-writes',
        command: 'kubectl apply -f x.yaml',
        root: loosened,
        env: { VULCAN_GUARD_ASKS: 'deny' },
      }).decision,
    ).toBe('deny');
  });

  test('toolOwnedPaths of the manifest opens a store, until the environment holds deny', () => {
    const root = projectOf({ guard: { toolOwnedPaths: ['/var/tmp/**'] } });
    const command = 'echo x > /var/tmp/vulcan-asks-probe.txt';

    expect(answerOf({ hook: 'guard-outside', command, root }).text).toBe('');

    const envs: Record<string, string>[] = [
      { VULCAN_GUARD_ASKS: 'deny' },
      { VULCAN_GUARD_OUTSIDE: 'deny' },
    ];

    for (const env of envs) {
      expect(answerOf({ hook: 'guard-outside', command, root, env }).decision).toBe('deny');
    }
  });

  test('a manifest that exists and cannot be read denies every ask, with the way to repair it', () => {
    for (const manifest of ['{ nope', '', '<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> topic\n', '[]']) {
      const root = createProject({
        files: { 'package.json': '{}', [GUARD_MANIFEST_FILE]: manifest },
      });

      for (const [hook, command] of [
        ['guard-writes', 'kubectl apply -f x.yaml'],
        ['guard-git', 'git reset --hard HEAD~1'],
        ['guard-outside', 'echo x > /var/tmp/vulcan-asks-probe.txt'],
      ] as const) {
        const held = answerOf({ hook, command, root });

        expect(held.decision, `${hook} ${JSON.stringify(manifest)}`).toBe('deny');
        expect(held.text, hook).toContain('cannot be read');
        expect(held.text, hook).toContain('vulcan project sync');
      }
    }
  });

  test.each(['guard-writes', 'guard-git', 'guard-outside'] as const)(
    '%s: a hook input it cannot read asks, and denies with asks set to deny',
    (hook) => {
      const stdin = 'this is not json';
      const asked = answerOf({ hook, stdin, root: projectOf({ guard: {} }) });
      const held = answerOf({ hook, stdin, root: projectOf({ guard: { asks: 'deny' } }) });

      expect(asked.decision).toBe('ask');
      expect(held.decision).toBe('deny');
    },
  );

  test('a heredoc body that never closes is denied whatever guard.asks says: the line cannot be read to its end', () => {
    const command = "cat <<'EOF'\ngit reset --hard HEAD~1";

    for (const guard of [{}, { asks: 'deny' }]) {
      expect(answerOf({ hook: 'guard-git', command, root: projectOf({ guard }) }).decision).toBe(
        'deny',
      );
    }
  });

  test('asks: deny does not touch a call no guard asks about, and a deny of the guards stays one', () => {
    const root = projectOf({ guard: { asks: 'deny' } });

    expect(answerOf({ hook: 'guard-writes', command: 'ls -la', root }).text).toBe('');
    expect(answerOf({ hook: 'guard-git', command: 'git status', root }).text).toBe('');
    expect(answerOf({ hook: 'guard-outside', command: 'ls docs', root }).text).toBe('');
    expect(
      answerOf({ hook: 'guard-git', command: 'git push --force origin main', root }).decision,
    ).toBe('deny');
  });

  test('with guard.outside set to deny alone, the other guards still ask', () => {
    const root = projectOf({ guard: { outside: 'deny' } });

    expect(
      answerOf({ hook: 'guard-writes', command: 'kubectl apply -f x.yaml', root }).decision,
    ).toBe('ask');
    expect(answerOf({ hook: 'guard-git', command: 'git reset --hard', root }).decision).toBe('ask');
    expect(
      answerOf({ hook: 'guard-outside', command: 'echo x > /var/tmp/vulcan-asks-probe.txt', root })
        .decision,
    ).toBe('deny');
  });

  test('a write outside the project that guard.asks holds names guard.asks, not guard.outside, as the reason', () => {
    const held = answerOf({
      hook: 'guard-outside',
      command: 'echo x > /var/tmp/vulcan-asks-probe.txt',
      root: projectOf({ guard: { asks: 'deny' } }),
    });

    expect(held.text).toContain('guard.asks');
    expect(held.text).not.toContain('Confirm only if');
  });
});
