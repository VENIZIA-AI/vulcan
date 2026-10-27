import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildManifestDecision,
  inspectManifestWrite,
  MANIFEST_BLOCK_MESSAGE,
  parseManifestHookInput,
} from '../../hooks/index.ts';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';

const HOOK = join(import.meta.dir, '..', '..', '..', 'base', 'hooks', 'guard-manifest.ts');
const SETTINGS = join(import.meta.dir, '..', '..', '..', 'base', 'claude', 'settings.json');
const ROOT = '/work/project';
const MANIFEST = '.agents/vulcan.manifest.json';

/** The wire form Claude Code sends (snake_case), built as text so the names stay at this boundary. */
const wire = (opts: { tool: string; input: string; cwd?: string }): string =>
  `{"tool_name":${JSON.stringify(opts.tool)},"tool_input":${opts.input},"cwd":${JSON.stringify(opts.cwd ?? '/tmp')}}`;

const TOOL_CASES: { name: string; tool: string; path: string; blocked: boolean }[] = [
  { name: 'Write, relative', tool: 'Write', path: MANIFEST, blocked: true },
  { name: 'Edit, absolute', tool: 'Edit', path: `${ROOT}/${MANIFEST}`, blocked: true },
  { name: 'MultiEdit, dot-slash', tool: 'MultiEdit', path: `./${MANIFEST}`, blocked: true },
  {
    name: 'Edit, a path that climbs back in',
    tool: 'Edit',
    path: `x/../${MANIFEST}`,
    blocked: true,
  },
  {
    name: 'Write, another file in .agents',
    tool: 'Write',
    path: '.agents/rules.md',
    blocked: false,
  },
  {
    name: 'Write, a file of that name elsewhere',
    tool: 'Write',
    path: 'docs/manifest.json',
    blocked: false,
  },
  { name: 'Write, the config', tool: 'Write', path: '.configs/vulcan.config.mts', blocked: false },
];

const COMMAND_CASES: { name: string; command: string; blocked: boolean }[] = [
  { name: 'redirect', command: `echo '{}' > ${MANIFEST}`, blocked: true },
  { name: 'append', command: `echo '{}' >> ${MANIFEST}`, blocked: true },
  { name: 'redirect with no space', command: `cat x >${MANIFEST}`, blocked: true },
  { name: 'absolute redirect', command: `jq . x > ${ROOT}/${MANIFEST}`, blocked: true },
  { name: 'tee', command: `cat x | tee ${MANIFEST}`, blocked: true },
  { name: 'tee -a', command: `echo x | tee -a ${MANIFEST} > /dev/null`, blocked: true },
  { name: 'sed -i', command: `sed -i 's/a/b/' ${MANIFEST}`, blocked: true },
  { name: 'cp onto it', command: `cp /tmp/m.json ${MANIFEST}`, blocked: true },
  { name: 'mv onto it', command: `mv /tmp/m.json ${MANIFEST}`, blocked: true },
  { name: 'rm', command: `rm ${MANIFEST}`, blocked: true },
  { name: 'cat reads it', command: `cat ${MANIFEST}`, blocked: false },
  {
    name: 'jq reads it into a temp file',
    command: `jq .name ${MANIFEST} > /tmp/name`,
    blocked: false,
  },
  { name: 'cp from it', command: `cp ${MANIFEST} /tmp/backup.json`, blocked: false },
  { name: 'git diff of it', command: `git diff -- ${MANIFEST}`, blocked: false },
  { name: 'vulcan sync itself', command: 'bun x --no-install vulcan sync', blocked: false },
  { name: 'redirect elsewhere', command: 'echo x > notes.txt', blocked: false },
];

describe('inspectManifestWrite', () => {
  for (const item of TOOL_CASES) {
    test(`${item.name}: ${item.blocked ? 'blocked' : 'allowed'}`, () => {
      expect(
        inspectManifestWrite({
          input: { tool: item.tool, filePath: item.path, command: undefined, cwd: ROOT },
        }),
      ).toBe(item.blocked);
    });
  }

  for (const item of COMMAND_CASES) {
    test(`Bash ${item.name}: ${item.blocked ? 'blocked' : 'allowed'}`, () => {
      expect(
        inspectManifestWrite({
          input: { tool: 'Bash', filePath: undefined, command: item.command, cwd: ROOT },
        }),
      ).toBe(item.blocked);
    });
  }
});

describe('parseManifestHookInput', () => {
  test('reads the tool, the file path and the command from the wire form', () => {
    expect(
      parseManifestHookInput({
        text: wire({ tool: 'Write', input: `{"file_path":"${MANIFEST}"}`, cwd: ROOT }),
      }),
    ).toEqual({ tool: 'Write', filePath: MANIFEST, command: undefined, cwd: ROOT });
  });

  test('a notebook edit carries notebook_path', () => {
    const input = parseManifestHookInput({
      text: wire({ tool: 'NotebookEdit', input: '{"notebook_path":"a.ipynb"}' }),
    });

    expect(input?.filePath).toBe('a.ipynb');
  });

  test('anything that is not a JSON object is not input', () => {
    expect(parseManifestHookInput({ text: 'not json' })).toBeUndefined();
    expect(parseManifestHookInput({ text: '[]' })).toBeUndefined();
  });
});

describe('the decision', () => {
  test('denies, with the message that says what to edit instead', () => {
    const decision = buildManifestDecision();

    expect(decision.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(decision.hookSpecificOutput.permissionDecisionReason).toBe(MANIFEST_BLOCK_MESSAGE);
    expect(MANIFEST_BLOCK_MESSAGE).toBe(
      'vulcan.manifest.json is generated - edit .configs/vulcan.config.* and run `vulcan sync`',
    );
  });
});

const runHook = (opts: { payload: string }) => {
  const child = spawnSyncBounded({
    cmd: [process.execPath, HOOK],
    cwd: ROOT.startsWith('/work') ? '/tmp' : ROOT,
    stdin: new Blob([opts.payload]),
    stdout: 'pipe',
    stderr: 'pipe',
  });

  return { code: child.exitCode, stdout: child.stdout.toString(), stderr: child.stderr.toString() };
};

describe('the hook script', () => {
  test('a Write to the manifest is denied with the message', () => {
    const result = runHook({
      payload: wire({ tool: 'Write', input: `{"file_path":"/tmp/p/${MANIFEST}"}` }),
    });
    const decision = JSON.parse(result.stdout);

    expect(result.code).toBe(0);
    expect(decision.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(decision.hookSpecificOutput.permissionDecisionReason).toContain('vulcan sync');
  });

  test('a Bash redirect into the manifest is denied', () => {
    const result = runHook({
      payload: wire({ tool: 'Bash', input: `{"command":"echo {} > ${MANIFEST}"}` }),
    });

    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
  });

  test('a harmless command prints nothing and exits 0', () => {
    const result = runHook({
      payload: wire({ tool: 'Bash', input: '{"command":"ls"}' }),
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
  });
});

describe('the shipped settings', () => {
  interface IEntry {
    matcher?: string;
    hooks: { command: string }[];
  }

  const entries = (): IEntry[] => JSON.parse(readFileSync(SETTINGS, 'utf8')).hooks.PreToolUse;

  test('guard-manifest.ts is registered on Write, Edit, MultiEdit, NotebookEdit and Bash', () => {
    const entry = entries().find((item) =>
      item.hooks.some((hook) => hook.command.includes('hooks/guard-manifest.ts')),
    );

    expect(entry?.matcher).toBeDefined();

    for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash']) {
      expect(new RegExp(`^(?:${entry?.matcher})$`).test(tool), tool).toBe(true);
    }
  });
});
