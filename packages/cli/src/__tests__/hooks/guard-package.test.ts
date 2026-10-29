import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  buildPackageDecision,
  inspectPackageWrite,
  parseManifestHookInput,
} from '../../hooks/index.ts';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';

const HOOK = join(import.meta.dir, '..', '..', '..', 'base', 'hooks', 'guard-package.ts');
const SETTINGS = join(import.meta.dir, '..', '..', '..', 'base', 'claude', 'settings.json');

/** The wire form Claude Code sends (snake_case), built as text so the names stay at this boundary. */
const wire = (opts: { tool: string; path: string; cwd: string }): string =>
  `{"tool_name":${JSON.stringify(opts.tool)},"tool_input":{"file_path":${JSON.stringify(opts.path)}},"cwd":${JSON.stringify(opts.cwd)}}`;

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const MANIFEST = {
  schemaVersion: 1,
  name: 'shop',
  layout: { backend: 'services', frontend: 'web', shared: 'libs' },
  packages: [{ name: 'api', dir: 'api', path: 'services/api' }],
  presets: [
    { spec: 'ignis', side: 'backend', summary: 'An API.', lib: 'A library.' },
    { spec: 'file:../acme-web', side: 'frontend', summary: 'An admin.' },
  ],
};

const project = (opts: { manifest?: unknown; files?: string[] } = {}): string => {
  const root = mkdtempSync(join(tmpdir(), 'vulcan-guard-package-'));

  roots.push(root);

  if (opts.manifest !== null) {
    mkdirSync(join(root, '.agents'), { recursive: true });
    writeFileSync(
      join(root, '.agents/vulcan.manifest.json'),
      JSON.stringify(opts.manifest ?? MANIFEST),
    );
  }

  for (const file of opts.files ?? []) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), '{}');
  }

  return root;
};

const write = (opts: { root: string; path: string; tool?: string }) =>
  inspectPackageWrite({
    input: {
      tool: opts.tool ?? 'Write',
      filePath: join(opts.root, opts.path),
      command: undefined,
      cwd: opts.root,
    },
  });

describe('inspectPackageWrite - a real command exists', () => {
  test('a new package.json in the backend folder is denied with the exact add command', () => {
    const root = project();
    const verdict = write({ root, path: 'services/api3/package.json' });

    expect(verdict?.kind).toBe('deny');
    expect(verdict?.message).toContain('bun x --no-install vulcan add --preset ignis --app api3');
    expect(verdict?.message).toContain('do not hand-write package.json, tsconfig or scripts');
  });

  test('a new package.json in the frontend folder names the api choice', () => {
    const verdict = write({ root: project(), path: 'web/admin2/package.json' });

    expect(verdict?.kind).toBe('deny');
    expect(verdict?.message).toContain(
      'bun x --no-install vulcan add --preset file:../acme-web --app admin2 --api <backend app> | --no-api',
    );
  });

  test('a new package.json in the shared folder is denied with the lib command', () => {
    const verdict = write({ root: project(), path: 'libs/billing/package.json' });

    expect(verdict?.kind).toBe('deny');
    expect(verdict?.message).toContain(
      'bun x --no-install vulcan add --preset ignis --lib billing',
    );
    expect(verdict?.message).not.toContain('--app billing');
  });

  test('a new package.json in the shared folder offers the lib command of each lib preset and the shared command of each shared preset', () => {
    const root = project({
      manifest: {
        ...MANIFEST,
        presets: [
          { spec: 'ignis', side: 'backend', summary: 'An API.', lib: 'A library.' },
          { spec: 'file:../kit', side: 'frontend', summary: 'A kit.', shared: 'Shared.' },
          {
            spec: 'file:../both',
            side: 'backend',
            summary: 'Both.',
            lib: 'A lib.',
            shared: 'A shared.',
          },
          { spec: 'file:../neither', side: 'backend', summary: 'Neither.' },
        ],
      },
    });
    const verdict = write({ root, path: 'libs/billing/package.json' });
    const message = verdict?.message ?? '';

    expect(verdict?.kind).toBe('deny');
    expect(message).toContain('bun x --no-install vulcan add --preset ignis --lib billing');
    expect(message).toContain('bun x --no-install vulcan add --preset file:../both --lib billing');
    expect(message).toContain(
      'bun x --no-install vulcan add --preset file:../kit --shared billing',
    );
    expect(message).toContain(
      'bun x --no-install vulcan add --preset file:../both --shared billing',
    );
    expect(message).not.toContain('--preset ignis --shared');
    expect(message).not.toContain('--preset file:../kit --lib');
    expect(message).not.toContain('file:../neither');
    expect(message).not.toContain('--app billing');
  });

  test('a preset with only a shared kind makes the shared folder a deny, with no lib command', () => {
    const root = project({
      manifest: {
        ...MANIFEST,
        presets: [{ spec: 'file:../kit', side: 'frontend', summary: 'A kit.', shared: 'Shared.' }],
      },
    });
    const verdict = write({ root, path: 'libs/billing/package.json' });

    expect(verdict?.kind).toBe('deny');
    expect(verdict?.message).toContain('--preset file:../kit --shared billing');
    expect(verdict?.message).not.toContain('--lib billing');
  });

  test('a shared folder in a list names the folder in both the lib and the shared command', () => {
    const root = project({
      manifest: {
        ...MANIFEST,
        layout: { ...MANIFEST.layout, shared: ['libs/a', 'libs/b'] },
        presets: [{ spec: 'ignis', side: 'backend', summary: 'An API.', lib: 'L', shared: 'S' }],
      },
    });
    const verdict = write({ root, path: 'libs/b/billing/package.json' });

    expect(verdict?.message).toContain('--preset ignis --lib billing --dir libs/b');
    expect(verdict?.message).toContain('--preset ignis --shared billing --dir libs/b');
  });

  test('a new package.json in a side folder never offers the shared command', () => {
    const root = project({
      manifest: {
        ...MANIFEST,
        presets: [
          { spec: 'ignis', side: 'backend', summary: 'An API.', lib: 'L', shared: 'S' },
          { spec: 'file:../acme-web', side: 'frontend', summary: 'An admin.', shared: 'S' },
        ],
      },
    });
    const backend = write({ root, path: 'services/api3/package.json' });
    const frontend = write({ root, path: 'web/admin2/package.json' });

    expect(backend?.kind).toBe('deny');
    expect(backend?.message).toContain('--preset ignis --app api3');
    expect(backend?.message).not.toContain('--shared');
    expect(backend?.message).not.toContain('--lib');
    expect(frontend?.kind).toBe('deny');
    expect(frontend?.message).toContain('--preset file:../acme-web --app admin2');
    expect(frontend?.message).not.toContain('--shared');
  });

  test('a recorded preset whose shared is not a string offers no shared command', () => {
    const root = project({
      manifest: {
        ...MANIFEST,
        presets: [{ spec: 'ignis', side: 'backend', summary: 'An API.', lib: 'L', shared: 5 }],
      },
    });
    const verdict = write({ root, path: 'libs/billing/package.json' });

    expect(verdict?.message).toContain('--lib billing');
    expect(verdict?.message).not.toContain('--shared');
  });

  test('a nested layout folder counts', () => {
    const root = project({
      manifest: { ...MANIFEST, layout: { shared: 'auroras/features' } },
    });

    expect(write({ root, path: 'auroras/features/merchant/package.json' })?.kind).toBe('deny');
  });

  test('a relative file path resolves against the cwd', () => {
    const root = project();
    const verdict = inspectPackageWrite({
      input: {
        tool: 'Write',
        filePath: 'services/api3/package.json',
        command: undefined,
        cwd: root,
      },
    });

    expect(verdict?.kind).toBe('deny');
  });
});

describe('inspectPackageWrite - a layout with several folders per side', () => {
  const GROUPED = {
    ...MANIFEST,
    layout: {
      backend: 'umbras',
      frontend: ['auroras/apps', 'auroras/guests', 'auroras/public'],
      shared: ['auroras/kits'],
      other: ['third-parties', 'auroras/tools', 'docs', 'qc'],
    },
  };

  test('a new package.json in any folder of a list is denied, with the folder named in the command', () => {
    const root = project({ manifest: GROUPED });
    const verdict = write({ root, path: 'auroras/guests/shop/package.json' });

    expect(verdict?.kind).toBe('deny');
    expect(verdict?.message).toContain(
      'vulcan add --preset file:../acme-web --app shop --frontend-dir auroras/guests --api <backend app> | --no-api',
    );
    expect(write({ root, path: 'auroras/public/site/package.json' })?.message).toContain(
      '--frontend-dir auroras/public',
    );
    expect(write({ root, path: 'auroras/kits/money/package.json' })?.message).toContain(
      '--lib money',
    );
  });

  test('a side with one folder keeps the command it had, with no folder flag', () => {
    const verdict = write({
      root: project({ manifest: GROUPED }),
      path: 'umbras/api3/package.json',
    });

    expect(verdict?.message).toContain('vulcan add --preset ignis --app api3 (ask');
    expect(verdict?.message).not.toContain('--backend-dir');
  });

  test('a folder listed under other is not guarded', () => {
    const root = project({ manifest: GROUPED });

    for (const path of [
      'third-parties/x/package.json',
      'auroras/tools/linter/package.json',
      'docs/wiki/package.json',
      'qc/tests/package.json',
    ]) {
      expect(write({ root, path }), path).toBeUndefined();
    }
  });

  test('the manifest is never trusted: a folder that is not one is dropped, the valid ones still count', () => {
    const root = project({
      manifest: {
        ...MANIFEST,
        layout: {
          backend: ['../outside', '/abs', 'a//b', 'a/node_modules/b', 'UPPER', 'ok/dir', 7, null],
          frontend: 'web',
        },
      },
    });

    expect(write({ root, path: 'ok/dir/api/package.json' })?.kind).toBe('deny');
    expect(write({ root, path: 'web/admin/package.json' })?.kind).toBe('deny');
    expect(write({ root, path: 'outside/api/package.json' })).toBeUndefined();
    expect(write({ root, path: 'UPPER/api/package.json' })).toBeUndefined();
  });
});

describe('inspectPackageWrite - silent', () => {
  test('a package.json that already exists is left alone', () => {
    const root = project({ files: ['services/api/package.json'] });

    expect(write({ root, path: 'services/api/package.json' })).toBeUndefined();
  });

  test('anything under node_modules is left alone', () => {
    expect(write({ root: project(), path: 'node_modules/left-pad/package.json' })).toBeUndefined();
    expect(
      write({ root: project(), path: 'services/api/node_modules/x/package.json' }),
    ).toBeUndefined();
  });

  test('another file in a layout folder is left alone', () => {
    expect(write({ root: project(), path: 'services/api3/src/index.ts' })).toBeUndefined();
    expect(write({ root: project(), path: 'services/api3/tsconfig.json' })).toBeUndefined();
  });

  test('a package.json outside every layout folder is left alone', () => {
    expect(write({ root: project(), path: 'tools/x/package.json' })).toBeUndefined();
    expect(write({ root: project(), path: 'package.json' })).toBeUndefined();
    expect(write({ root: project(), path: 'services/package.json' })).toBeUndefined();
  });

  test('a deeper package.json inside an app is not a new package', () => {
    expect(
      write({ root: project(), path: 'services/api/fixtures/x/package.json' }),
    ).toBeUndefined();
  });

  test('a project with no manifest, or one without a layout, is left alone', () => {
    expect(
      write({ root: project({ manifest: null }), path: 'services/api3/package.json' }),
    ).toBeUndefined();
    expect(
      write({
        root: project({ manifest: { schemaVersion: 1, name: 'bare' } }),
        path: 'services/api3/package.json',
      }),
    ).toBeUndefined();
  });

  test('a tool that is not Write is left alone', () => {
    expect(
      write({ root: project(), path: 'services/api3/package.json', tool: 'Edit' }),
    ).toBeUndefined();
    expect(
      write({ root: project(), path: 'services/api3/package.json', tool: 'Bash' }),
    ).toBeUndefined();
  });

  test('an unreadable manifest lets the call through', () => {
    const root = project({ manifest: null });

    mkdirSync(join(root, '.agents'), { recursive: true });
    writeFileSync(join(root, '.agents/vulcan.manifest.json'), 'not json');
    expect(write({ root, path: 'services/api3/package.json' })).toBeUndefined();
  });
});

describe('inspectPackageWrite - no real command: warn, never block', () => {
  test('a layout folder whose side no recorded preset makes', () => {
    const root = project({
      manifest: {
        ...MANIFEST,
        presets: [{ spec: 'file:../acme-web', side: 'frontend', summary: 'x' }],
      },
    });
    const verdict = write({ root, path: 'services/api3/package.json' });

    expect(verdict?.kind).toBe('warn');
    expect(verdict?.message).toContain('no recorded preset makes a backend app');
    expect(verdict?.message).toContain('ask the user');
    expect(verdict?.message).not.toContain('vulcan add --preset');
  });

  test('the shared folder when no preset makes a lib', () => {
    const root = project({
      manifest: { ...MANIFEST, presets: [{ spec: 'ignis', side: 'backend', summary: 'x' }] },
    });
    const verdict = write({ root, path: 'libs/billing/package.json' });

    expect(verdict?.kind).toBe('warn');
    expect(verdict?.message).toContain('no recorded preset makes a lib');
  });

  test('a project that recorded no preset at all', () => {
    const root = project({ manifest: { ...MANIFEST, presets: undefined } });
    const verdict = write({ root, path: 'services/api3/package.json' });

    expect(verdict?.kind).toBe('warn');
    expect(verdict?.message).toContain('ask the user which preset to use');
  });
});

describe('parse and decision', () => {
  test('the wire form reads as before', () => {
    expect(
      parseManifestHookInput({
        text: '{"tool_name":"Write","tool_input":{"file_path":"a/package.json"},"cwd":"/x"}',
      }),
    ).toEqual({ tool: 'Write', filePath: 'a/package.json', command: undefined, cwd: '/x' });
  });

  test('a deny carries the reason; a warn carries context and no decision', () => {
    const deny = buildPackageDecision({ verdict: { kind: 'deny', message: 'use add' } });
    const warn = buildPackageDecision({ verdict: { kind: 'warn', message: 'ask the user' } });

    const denied: Record<string, unknown> = deny.hookSpecificOutput;
    const warned: Record<string, unknown> = warn.hookSpecificOutput;

    expect(denied.permissionDecision).toBe('deny');
    expect(denied.permissionDecisionReason).toBe('use add');
    expect(warned.additionalContext).toBe('ask the user');
    expect(warned).not.toHaveProperty('permissionDecision');
  });
});

describe('the hook script', () => {
  const run = (opts: { root: string; path: string }) => {
    const child = spawnSyncBounded({
      cmd: [process.execPath, HOOK],
      cwd: opts.root,
      stdin: new Blob([wire({ tool: 'Write', path: join(opts.root, opts.path), cwd: opts.root })]),
      stdout: 'pipe',
      stderr: 'pipe',
    });

    return { code: child.exitCode, stdout: child.stdout.toString() };
  };

  test('a new package in the backend folder is denied with the command', () => {
    const result = run({ root: project(), path: 'services/api3/package.json' });

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(result.stdout).toContain('vulcan add --preset ignis --app api3');
  });

  test('an existing file prints nothing and exits 0', () => {
    const root = project({ files: ['services/api/package.json'] });
    const result = run({ root, path: 'services/api/package.json' });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
  });

  test('a warn prints context and exits 0', () => {
    const root = project({ manifest: { ...MANIFEST, presets: undefined } });
    const result = run({ root, path: 'services/api3/package.json' });

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).hookSpecificOutput.additionalContext).toContain(
      'ask the user',
    );
  });
});

describe('the shipped settings', () => {
  test('guard-package.ts is registered on Write only', () => {
    const entries: { matcher?: string; hooks: { command: string }[] }[] = JSON.parse(
      readFileSync(SETTINGS, 'utf8'),
    ).hooks.PreToolUse;
    const entry = entries.find((item) =>
      item.hooks.some((hook) => hook.command.includes('hooks/guard-package.ts')),
    );

    expect(entry?.matcher).toBe('Write');
  });
});
