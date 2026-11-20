import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HooksBundle } from '../../sync/hooks-bundle.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const READ_ONLY_PROJECT = {
  '.configs/vulcan.config.mts': "export default { rules: { 'V-W-01': 'read-only' } };\n",
  'AGENTS.md': '# x\n',
};

const runSync = (opts: { root: string }) => runCli({ args: ['sync'], cwd: opts.root });
const folderOf = (root: string): string => join(root, '.agents', 'local', 'hooks');
const source = HooksBundle.source();
const names = Object.keys(source?.sums.files ?? {});

describe('the hook bundle the package ships', () => {
  test('is one self-contained file for every hook of base/hooks, with the sha256 of each beside it', () => {
    expect(source).toBeDefined();
    expect(names).toEqual(
      [
        'antigravity-guards.js',
        'auto-clean.js',
        'codex-guards.js',
        'event.js',
        'guard-git.js',
        'guard-outside.js',
        'guard-writes.js',
        'session-start.js',
        'subagent-start.js',
      ].sort(),
    );

    for (const [name, sum] of Object.entries(source?.sums.files ?? {})) {
      expect(sum, name).toMatch(/^[0-9a-f]{64}$/);
      expect(
        HooksBundle.sha256({ bytes: readFileSync(join(source?.folder ?? '', name)) }),
        name,
      ).toBe(sum);
    }
  });

  test('is built the same way twice: the same sources and the same bun give the same bytes', () => {
    const one = HooksBundle.build({
      folder: join(createProject({ files: {} }), 'a'),
      version: '0.0.0',
    });
    const two = HooksBundle.build({
      folder: join(createProject({ files: {} }), 'b'),
      version: '0.0.0',
    });

    expect(one.files).toEqual(two.files);
  });

  test('runs from another folder with nothing beside it: no node_modules, no sources', () => {
    const root = createProject({ files: {} });
    const copy = join(root, 'alone.js');

    writeFileSync(copy, readFileSync(join(source?.folder ?? '', 'guard-git.js')));

    const result = Bun.spawnSync(['bun', '--no-env-file', '--config=/dev/null', copy], {
      cwd: root,
      stdin: new Blob([
        `{"tool_name":"Bash","tool_input":{"command":"git push --force origin main"},"cwd":"${root}"}`,
      ]),
    });

    expect(result.stdout.toString()).toContain('"permissionDecision":"deny"');
  });
});

describe('vulcan sync copies the bundle into the project', () => {
  test('writes .agents/local/hooks, read-only, byte for byte, and points the settings at it', () => {
    const root = createProject({ files: READ_ONLY_PROJECT });

    expect(runSync({ root }).code).toBe(0);
    expect(readdirSync(folderOf(root)).sort()).toEqual(names);

    for (const [name, sum] of Object.entries(source?.sums.files ?? {})) {
      const file = join(folderOf(root), name);

      expect(HooksBundle.sha256({ bytes: readFileSync(file) }), name).toBe(sum);
      expect(statSync(file).mode & 0o777, name).toBe(0o444);
    }

    const settings = readFileSync(join(root, '.claude', 'settings.json'), 'utf8');

    expect(settings).toContain('.agents/local/hooks/guard-git.js');
    expect(settings).not.toContain('node_modules/@venizia/vulcan/base/hooks');
  });

  test('records the version and the sha256 of every file in the manifest', () => {
    const root = createProject({ files: READ_ONLY_PROJECT });

    runSync({ root });

    const manifest = JSON.parse(
      readFileSync(join(root, '.agents', 'vulcan.manifest.json'), 'utf8'),
    );

    expect(manifest.hooks).toEqual({
      version: source?.sums.version,
      folder: '.agents/local/hooks',
      sha256: source?.sums.files,
    });
  });

  test('a second sync changes nothing, and a hand-edited copy is written back', () => {
    const root = createProject({ files: READ_ONLY_PROJECT });

    runSync({ root });

    expect(runSync({ root }).stderr).not.toContain('replaced .agents/local/hooks');

    const file = join(folderOf(root), 'guard-git.js');

    chmodSync(file, 0o644);
    writeFileSync(file, '// the agent was here\n');

    const again = runSync({ root });

    expect(again.stderr).toContain('.agents/local/hooks');
    expect(readFileSync(file, 'utf8')).toBe(
      readFileSync(join(source?.folder ?? '', 'guard-git.js'), 'utf8'),
    );
    expect(statSync(file).mode & 0o777).toBe(0o444);
  });

  test('a file the version no longer has is removed, and only the files of the bundle are kept', () => {
    const root = createProject({ files: READ_ONLY_PROJECT });

    runSync({ root });
    writeFileSync(join(folderOf(root), 'retired-hook.js'), 'x');
    runSync({ root });

    expect(existsSync(join(folderOf(root), 'retired-hook.js'))).toBe(false);
    expect(readdirSync(folderOf(root)).sort()).toEqual(names);
  });

  test('doctor reports a bundle that was changed after sync, and is quiet before', () => {
    const root = createProject({ files: READ_ONLY_PROJECT });

    runSync({ root });

    const quiet = runCli({ args: ['doctor'], cwd: root });

    expect(quiet.stderr).not.toContain('.agents/local/hooks');

    const file = join(folderOf(root), 'guard-outside.js');

    chmodSync(file, 0o644);
    writeFileSync(file, '// switched off\n');

    expect(runCli({ args: ['doctor'], cwd: root }).stderr).toContain('.agents/local/hooks');
  });
});

describe('a bundle that is not the one the manifest records for the same version is not copied', () => {
  const shipped = source?.sums;

  if (shipped === undefined) {
    throw new Error('no bundle');
  }

  const forged = {
    version: shipped.version,
    sha256: { ...shipped.files, 'guard-git.js': '0'.repeat(64) },
  };

  test('refusal names the files that differ, and nothing differs for the same sums', () => {
    const same = { version: shipped.version, sha256: shipped.files };

    expect(HooksBundle.refusal({ shipped, previous: same, isPinned: true })).toBeUndefined();
    expect(HooksBundle.refusal({ shipped, previous: forged, isPinned: true })).toContain(
      'guard-git.js',
    );
    // Another version is a new bundle: the manifest diff shows it, and sync takes it.
    expect(
      HooksBundle.refusal({ shipped, previous: { ...forged, version: '0.0.1' }, isPinned: true }),
    ).toBeUndefined();
    expect(HooksBundle.refusal({ shipped, previous: undefined, isPinned: true })).toBeUndefined();
  });

  test('a workspace is not pinned: its hooks change with its sources, and CI compares the committed manifest', () => {
    expect(HooksBundle.isInstalled()).toBe(false);
    expect(HooksBundle.refusal({ shipped, previous: forged })).toBeUndefined();
  });

  test('where it is pinned, the plan copies nothing and the manifest keeps the recorded sums', () => {
    const root = createProject({ files: READ_ONLY_PROJECT });

    runSync({ root });

    const file = join(folderOf(root), 'guard-git.js');

    chmodSync(file, 0o644);
    writeFileSync(file, '// not the shipped one\n');

    const [action] = HooksBundle.plan({ root, previous: forged, isPinned: true });

    expect(action?.status).toBe('skipped');
    expect(action?.note).toContain('not copied');
    action?.apply();
    expect(readFileSync(file, 'utf8')).toBe('// not the shipped one\n');
    expect(
      HooksBundle.manifestBlock({ previous: forged, isPinned: true })?.sha256['guard-git.js'],
    ).toBe('0'.repeat(64));
    expect(HooksBundle.manifestBlock({ previous: undefined, isPinned: true })?.sha256).toEqual(
      shipped.files,
    );
  });
});
