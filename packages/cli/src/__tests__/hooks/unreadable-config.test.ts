import { afterAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { SPAWN_TIMEOUT_MS } from '@venizia/dev-configs/testing';
import { ConfigLoader } from '../../config/index.ts';
import { SessionDigest } from '../../hooks/index.ts';
import { isolateOwnerReplySwitch } from '../owner-reply-env.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { GUARD_MANIFEST_FILE, guardManifest } from '../guard-manifest.helper.ts';

afterAll(removeProjects);
isolateOwnerReplySwitch();

const HOOKS = join(import.meta.dir, '..', '..', '..', 'base', 'hooks');

/** A config this VULCAN reads: `outside` denies. */
const READABLE = "export default { guard: { outside: 'deny' } };\n";

/** The same config plus a key of a newer release: the strict schema refuses the whole file. */
const UNREADABLE = "export default { guard: { outside: 'deny' }, aKeyOfANewerRelease: true };\n";

const NOTE = 'the project config could not be read by this VULCAN, so its defaults apply';

const runHook = async (opts: { hook: string; stdin: string; root: string }) => {
  const child = Bun.spawn([process.execPath, join(HOOKS, `${opts.hook}.ts`)], {
    cwd: opts.root,
    stdin: new TextEncoder().encode(opts.stdin),
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, CLAUDE_PROJECT_DIR: opts.root },
    timeout: SPAWN_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  });
  const stdoutResponse = new Response(child.stdout);
  const stdout = await stdoutResponse.text();
  const stderrResponse = new Response(child.stderr);
  const stderr = await stderrResponse.text();

  await child.exited;

  return { stdout: stdout.trim(), stderr: stderr.trim() };
};

/** The hook input as Claude Code sends it: the wire names stay in a string, not in an object literal. */
const writeOutside = (opts: { root: string }): string =>
  `{"tool_name":"Write","tool_input":{"file_path":"/srv/vulcan-fixture/outside-the-project.txt","content":"x"},"cwd":${JSON.stringify(opts.root)}}`;

const decisionOf = (opts: { stdout: string }): { decision: string; reason: string } => {
  const output: {
    hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
  } = JSON.parse(opts.stdout);

  return {
    decision: output.hookSpecificOutput.permissionDecision,
    reason: output.hookSpecificOutput.permissionDecisionReason,
  };
};

describe('ConfigLoader.unreadableNote', () => {
  test('a config that loads has no note', async () => {
    const root = createProject({ files: { '.configs/vulcan.config.mts': READABLE } });

    const result = await ConfigLoader.load({ root });
    expect(ConfigLoader.unreadableNote({ loaded: result })).toBeUndefined();
  });

  test('a project with no config has no note: nothing was ignored', async () => {
    const root = createProject({ files: {} });

    const result = await ConfigLoader.load({ root });
    expect(ConfigLoader.unreadableNote({ loaded: result })).toBeUndefined();
  });

  test('a config the schema refuses names the first problem and the way out', async () => {
    const root = createProject({ files: { '.configs/vulcan.config.mts': UNREADABLE } });
    const result = await ConfigLoader.load({ root });
    const note = ConfigLoader.unreadableNote({ loaded: result });

    expect(note).toContain(NOTE);
    expect(note).toContain('aKeyOfANewerRelease');
    expect(note).toContain('vulcan upgrade');
  });

  test('a load error of several lines is told by its head, not by its second line', async () => {
    const root = createProject({
      files: {
        '.configs/vulcan.config.mts':
          "throw new Error('first line of the failure\\nsecond line of it');\n",
      },
    });
    const result = await ConfigLoader.load({ root });
    const note = ConfigLoader.unreadableNote({ loaded: result });

    expect(note).toContain('failed to load - first line of the failure');
    expect(note).not.toContain('(second line of it)');
  });

  test('a config that fails to import names the failure', async () => {
    const root = createProject({
      files: { '.configs/vulcan.config.mts': 'export default { ;\n' },
    });
    const result = await ConfigLoader.load({ root });
    const note = ConfigLoader.unreadableNote({ loaded: result });

    expect(note).toContain(NOTE);
    expect(note).toContain('failed to load');
  });
});

const DENY_MANIFEST = guardManifest({ guard: { outside: 'deny' } });

describe('the guard-outside hook with a config that does not parse', () => {
  test('the synced deny holds with a readable config', async () => {
    const root = createProject({
      files: { '.configs/vulcan.config.mts': READABLE, [GUARD_MANIFEST_FILE]: DENY_MANIFEST },
    });
    const result = await runHook({ hook: 'guard-outside', stdin: writeOutside({ root }), root });

    expect(decisionOf(result).decision).toBe('deny');
    expect(result.stderr).toBe('');
  });

  test('a key this VULCAN does not know in the config no longer weakens deny to ask', async () => {
    const root = createProject({
      files: { '.configs/vulcan.config.mts': UNREADABLE, [GUARD_MANIFEST_FILE]: DENY_MANIFEST },
    });
    const result = await runHook({ hook: 'guard-outside', stdin: writeOutside({ root }), root });

    expect(decisionOf(result).decision).toBe('deny');
  });

  test('with no manifest guard block the default is ask, config or no config', async () => {
    const variants: Record<string, string>[] = [{}, { '.configs/vulcan.config.mts': UNREADABLE }];

    for (const files of variants) {
      const root = createProject({ files });
      const result = await runHook({ hook: 'guard-outside', stdin: writeOutside({ root }), root });

      expect(decisionOf(result).decision).toBe('ask');
      expect(result.stderr).toBe('');
    }
  });
});

describe('the guard-writes hook with a config that does not parse', () => {
  const command = (opts: { root: string }): string =>
    `{"tool_name":"Bash","tool_input":{"command":"bun scripts/tidy.ts"},"cwd":${JSON.stringify(opts.root)}}`;

  test('loads no config: it says nothing about one', async () => {
    const root = createProject({ files: { '.configs/vulcan.config.mts': UNREADABLE } });
    const result = await runHook({ hook: 'guard-writes', stdin: command({ root }), root });

    expect(result.stderr).toBe('');
  });
});

describe('the session digest with a config that does not parse', () => {
  test('shows the problem and does not claim the project chose nothing', async () => {
    const root = createProject({ files: { '.configs/vulcan.config.mts': UNREADABLE } });
    const digest = await SessionDigest.build({ projectRoot: root });

    expect(digest).toContain('## Config problem');
    expect(digest).toContain('aKeyOfANewerRelease');
    expect(digest).toContain('**unknown** - the config could not be read');
    expect(digest).not.toContain('**not chosen**');
  });

  test('a readable config has no config problem section', async () => {
    const root = createProject({ files: { '.configs/vulcan.config.mts': READABLE } });
    const digest = await SessionDigest.build({ projectRoot: root });

    expect(digest).not.toContain('## Config problem');
  });
});
