import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import vulcanGuards from '../../../base/extensions/vulcan-guards.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const PACKAGE_ROOT = join(import.meta.dir, '..', '..', '..');

interface IBlock {
  block: boolean;
  reason: string;
}

type TEvent = { toolName: string; input: Record<string, unknown> };
type TContext = {
  cwd: string;
  hasUI: boolean;
  ui: { confirm: (title: string, message: string) => Promise<boolean> };
};
type THandler = (event: TEvent, context: TContext) => Promise<IBlock | undefined>;

/** The `tool_call` handler the extension registers on a host, as omp and pi would call it. */
const handlerOf = (): THandler => {
  let captured: THandler | undefined;

  vulcanGuards({
    on: (_event, handler) => {
      captured = handler;
    },
  });

  if (captured === undefined) {
    throw new Error('the extension registered no tool_call handler');
  }

  return captured;
};

const contextOf = (opts: { cwd: string; hasUI?: boolean; answer?: boolean }): TContext => ({
  cwd: opts.cwd,
  hasUI: opts.hasUI ?? false,
  ui: { confirm: async () => opts.answer ?? false },
});

const bash = (command: string): TEvent => ({ toolName: 'bash', input: { command } });

/** A project with the package installed: the real guard scripts run. */
const installedProject = (): string => {
  const root = createProject({ files: { 'package.json': '{}' } });
  const installed = join(root, 'node_modules', '@venizia', 'vulcan');

  mkdirSync(dirname(installed), { recursive: true });
  symlinkSync(PACKAGE_ROOT, installed);

  return root;
};

/** A project whose installed guards are the real ones except `broken`, which exits 3. */
const projectWithBrokenGuard = (opts: { broken: string }): string => {
  const root = createProject({ files: { 'package.json': '{}' } });
  const installed = join(root, 'node_modules', '@venizia', 'vulcan');
  const hooks = join(installed, 'base', 'hooks');

  mkdirSync(hooks, { recursive: true });
  symlinkSync(join(PACKAGE_ROOT, 'src'), join(installed, 'src'));

  for (const file of readdirSync(join(PACKAGE_ROOT, 'base', 'hooks'))) {
    if (file === `${opts.broken}.ts`) {
      writeFileSync(join(hooks, file), 'process.exit(3);\n');
    } else {
      symlinkSync(join(PACKAGE_ROOT, 'base', 'hooks', file), join(hooks, file));
    }
  }

  return root;
};

describe('the omp and pi extension runs the real guards', () => {
  test('a force-push to main is blocked with the guard reason; a status passes', async () => {
    const root = installedProject();
    const handle = handlerOf();
    const push = await handle(bash('git push -f origin main'), contextOf({ cwd: root }));

    expect(push?.block).toBe(true);
    expect(push?.reason).toContain("force-pushing to 'main'");
    const result = await handle(bash('git status'), contextOf({ cwd: root }));
    expect(result).toBeUndefined();
  });

  test('every guard of the Claude settings is reached: a deploy, a manifest write, a hand-made package', async () => {
    const root = installedProject();
    const handle = handlerOf();
    const deploy = await handle(bash('kubectl apply -f deploy.yaml'), contextOf({ cwd: root }));
    const manifest = await handle(
      {
        toolName: 'write',
        input: { path: join(root, '.agents', 'vulcan.manifest.json'), content: '{}' },
      },
      contextOf({ cwd: root }),
    );
    const edit = await handle(
      { toolName: 'edit', input: { path: join(root, '.agents', 'vulcan.manifest.json') } },
      contextOf({ cwd: root }),
    );

    expect(deploy?.block).toBe(true);
    expect(deploy?.reason).toContain('V-W-03');
    expect(manifest?.block).toBe(true);
    expect(edit?.block).toBe(true);
  });

  test('an ask is put to the owner when there is a UI, and blocks when there is none', async () => {
    const root = installedProject();
    const handle = handlerOf();
    const outside = bash('touch /var/tmp/vulcan-guard-probe-never-created');

    const noUi = await handle(outside, contextOf({ cwd: root }));
    const yes = await handle(outside, contextOf({ cwd: root, hasUI: true, answer: true }));
    const no = await handle(outside, contextOf({ cwd: root, hasUI: true, answer: false }));

    expect(noUi?.block).toBe(true);
    expect(noUi?.reason).toContain('V-B-08');
    expect(noUi?.reason).toContain('no UI to confirm');
    expect(yes).toBeUndefined();
    expect(no).toEqual({ block: true, reason: 'declined by the owner' });
  });

  test('a tool no guard covers passes; the root is found from a subfolder', async () => {
    const root = installedProject();
    const sub = join(root, 'src', 'deep');
    const handle = handlerOf();

    mkdirSync(sub, { recursive: true });

    const result = await handle(
      { toolName: 'read', input: { path: '/etc/passwd' } },
      contextOf({ cwd: root }),
    );
    expect(result).toBeUndefined();
    const pushed = await handle(bash('git push -f origin main'), contextOf({ cwd: sub }));

    expect(pushed?.block).toBe(true);
  });

  test('VULCAN_GUARDS=off passes everything, as it does in Claude Code', async () => {
    const root = installedProject();
    const handle = handlerOf();
    const before = process.env.VULCAN_GUARDS;

    process.env.VULCAN_GUARDS = 'off';

    try {
      const result = await handle(bash('git push -f origin main'), contextOf({ cwd: root }));
      expect(result).toBeUndefined();
    } finally {
      if (before === undefined) {
        delete process.env.VULCAN_GUARDS;
      } else {
        process.env.VULCAN_GUARDS = before;
      }
    }
  });
});

describe('a guard that cannot answer follows the policy of the Claude wrappers', () => {
  test('a broken drift guard (guard-git exits 3) asks: blocked with no UI, put to the owner with one', async () => {
    const root = projectWithBrokenGuard({ broken: 'guard-git' });
    const handle = handlerOf();
    const noUi = await handle(bash('git status'), contextOf({ cwd: root }));
    const yes = await handle(
      bash('git status'),
      contextOf({ cwd: root, hasUI: true, answer: true }),
    );

    expect(noUi?.block).toBe(true);
    expect(noUi?.reason).toContain('guard-git crashed or timed out');
    expect(yes).toBeUndefined();
  });

  test('a broken safety guard (guard-writes exits 3) blocks, UI or not', async () => {
    const root = projectWithBrokenGuard({ broken: 'guard-writes' });
    const handle = handlerOf();
    const result = await handle(bash('ls'), contextOf({ cwd: root, hasUI: true, answer: true }));

    expect(result?.block).toBe(true);
    expect(result?.reason).toContain('guard-writes crashed or timed out');
  });

  test('with the guard scripts missing, the safety guards block and the rest pass, bar a bare bun install', async () => {
    // An install with no scripts in it: the folder is found, the scripts are not (a test folder sits under the
    // repository, whose own install would otherwise be found above it).
    const root = createProject({ files: { 'package.json': '{}' } });
    const handle = handlerOf();

    mkdirSync(join(root, 'node_modules', '@venizia', 'vulcan', 'base', 'hooks'), {
      recursive: true,
    });

    const listed = await handle(bash('ls'), contextOf({ cwd: root }));

    expect(listed?.reason).toContain('run bun install');

    const result = await handle(bash('bun install'), contextOf({ cwd: root }));
    expect(result).toBeUndefined();
    const result2 = await handle(bash('bun install --frozen-lockfile'), contextOf({ cwd: root }));
    expect(result2).toBeUndefined();
    const chained = await handle(bash('bun install && ls'), contextOf({ cwd: root }));

    expect(chained?.block).toBe(true);

    const written = await handle(
      { toolName: 'write', input: { path: join(root, 'a.txt'), content: '' } },
      contextOf({ cwd: root }),
    );

    expect(written?.block).toBe(true);
    const result3 = await handle(
      { toolName: 'read', input: { path: 'a.txt' } },
      contextOf({ cwd: root }),
    );
    expect(result3).toBeUndefined();
  });
});
