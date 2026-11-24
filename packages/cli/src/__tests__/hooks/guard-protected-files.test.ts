import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';
import { OutsideGuard } from '../../hooks/index.ts';
import { fileToolEvent, toolEvent } from '../hook-event.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const HOOK = join(import.meta.dir, '..', '..', '..', 'base', 'hooks', 'guard-outside.ts');

/** The files the guards read their policy from, as the project root sees them. */
const PROTECTED = [
  '.agents/vulcan.manifest.json',
  '.agents/local/vulcan.manifest.json',
  '.configs/vulcan.config.mts',
  '.configs/vulcan.config.ts',
  '.configs/vulcan/claude.mts',
  '.configs/vulcan/index.mts',
  '.claude/settings.json',
  '.claude/settings.local.json',
  '.agents/local/profile.json',
  '.agents/vulcan.local.json',
  'node_modules/@venizia/vulcan/base/hooks/guard-outside.ts',
  'node_modules/@venizia/vulcan/package.json',
];

/** Every way a command line writes, removes or edits a file in place, with the path put in. */
const FORMS: [string, (path: string) => string][] = [
  ['a redirect', (path) => `echo x > ${path}`],
  ['an append', (path) => `echo x >> ${path}`],
  ['a redirect of stderr', (path) => `ls nope 2> ${path}`],
  ['tee', (path) => `echo x | tee ${path}`],
  ['tee -a', (path) => `echo x | tee -a ${path}`],
  ['cp', (path) => `cp other ${path}`],
  ['cp -f /dev/null', (path) => `cp -f /dev/null ${path}`],
  ['mv onto it', (path) => `mv other ${path}`],
  ['mv away from it', (path) => `mv ${path} other`],
  ['mv -t', (path) => `mv -t ${dirname(path)} ${path}`],
  ['install', (path) => `install -m 644 other ${path}`],
  ['ln -sf', (path) => `ln -sf other ${path}`],
  ['rm', (path) => `rm ${path}`],
  ['rm -f', (path) => `rm -f ${path}`],
  ['unlink', (path) => `unlink ${path}`],
  ['shred', (path) => `shred -u ${path}`],
  ['truncate', (path) => `truncate -s 0 ${path}`],
  ['sed -i', (path) => `sed -i s/deny/ask/ ${path}`],
  ['sed -i with a suffix', (path) => `sed -i.bak s/deny/ask/ ${path}`],
  ['sed -ni', (path) => `sed -ni 1p ${path}`],
  ['sed --in-place', (path) => `sed --in-place s/deny/ask/ ${path}`],
  ['sed -i -e', (path) => `sed -i -e s/deny/ask/ ${path}`],
  ['perl -pi', (path) => `perl -pi -e 's/deny/ask/' ${path}`],
  ['perl -i.bak', (path) => `perl -i.bak -pe 's/deny/ask/' ${path}`],
  ['dd of=', (path) => `dd if=/dev/null of=${path}`],
  ['git rm', (path) => `git rm ${path}`],
  ['git mv', (path) => `git mv ${path} other`],
  ['git restore', (path) => `git restore ${path}`],
  ['git checkout --', (path) => `git checkout -- ${path}`],
  ['sudo rm', (path) => `sudo rm ${path}`],
  ['a command after cd', (path) => `cd ${dirname(path)} && echo x > ${path.split('/').at(-1)}`],
  ['a chained command', (path) => `ls && echo x > ${path}; ls`],
];

const project = (): string => {
  const root = createProject({ files: { 'package.json': '{}', other: 'x' } });

  mkdirSync(join(root, 'dir'), { recursive: true });

  return root;
};

const protectedHitsOf = (opts: { root: string; command: string }) =>
  OutsideGuard.inspect({
    input: { tool: 'Bash', command: opts.command, cwd: opts.root, filePath: undefined },
    projectRoot: opts.root,
    env: { HOME: '/nonexistent-home' },
  }).filter((hit) => hit.isProtected === true);

describe('guard-outside denies a write to a file the guards read their policy from', () => {
  const root = project();

  test.each(PROTECTED.flatMap((path) => FORMS.map(([form, make]) => ({ path, form, make }))))(
    '$form on $path',
    ({ path, make }) => {
      const hits = protectedHitsOf({ root, command: make(path) });

      expect(hits.length).toBeGreaterThan(0);
    },
  );

  test.each(PROTECTED)(
    'an absolute path, a ./ path and a path with .. name the same file: %s',
    (path) => {
      for (const named of [
        `${root}/${path}`,
        `./${path}`,
        `dir/../${path}`,
        `${root}/dir/../${path}`,
      ]) {
        expect(
          protectedHitsOf({ root, command: `echo x > ${named}` }).length,
          named,
        ).toBeGreaterThan(0);
      }
    },
  );

  test.each([
    '.claude/Settings.local.json',
    '.Claude/settings.json',
    '.AGENTS/Local/Vulcan.Manifest.JSON',
    '.configs/VULCAN.CONFIG.MTS',
    'Node_Modules/@Venizia/Vulcan/base/hooks/guard-outside.ts',
  ])('the path is compared without regard to case: %s', (path) => {
    expect(protectedHitsOf({ root, command: `echo x > ${path}` }).length).toBeGreaterThan(0);
    expect(protectedHitsOf({ root, command: `sed -i s/a/b/ ${path}` }).length).toBeGreaterThan(0);
  });

  test('a symbolic link to one of them names it: a write through the link is denied', () => {
    const linked = createProject({
      files: { 'package.json': '{}', '.agents/local/vulcan.manifest.json': '{}' },
    });

    symlinkSync(
      join(linked, '.agents', 'local', 'vulcan.manifest.json'),
      join(linked, 'innocent.json'),
    );

    expect(
      protectedHitsOf({ root: linked, command: 'echo x > innocent.json' }).length,
    ).toBeGreaterThan(0);
    expect(
      protectedHitsOf({ root: linked, command: 'sed -i s/a/b/ innocent.json' }).length,
    ).toBeGreaterThan(0);
  });

  test.each([
    'rm -rf .claude',
    'rm -rf .configs',
    'rm -r .agents',
    'mv .claude gone',
    'rm -rf .configs/vulcan',
    'mv .configs/vulcan gone',
    'rm .configs/vulcan/*.mts',
    'rm .configs/vulcan/*',
  ])('removing or moving a folder that holds one of them is denied: %s', (command) => {
    expect(protectedHitsOf({ root, command }).length).toBeGreaterThan(0);
  });

  test.each([
    'cat .agents/local/vulcan.manifest.json',
    'grep asks .agents/local/vulcan.manifest.json',
    'sed -n 1p .agents/local/vulcan.manifest.json',
    'sed s/a/b/ .agents/local/vulcan.manifest.json',
    'cp .claude/settings.json other',
    'ls .claude',
    'rm src/index.ts',
    'rm -rf .agents/tmp/job',
    'rm -rf node_modules',
    'rm -rf node_modules/@venizia',
    'mv a b',
    'git checkout main',
    'git checkout -b feature/x',
    'git rm src/a.ts',
    'git restore src/a.ts',
    'echo x > .claude/other.json',
    'echo x > .configs/other.mts',
    'echo x > .configs/lints/eslint.config.mts',
    'rm .configs/lints/*.mts',
    'echo x > .agents/tmp/a',
    'echo x > .agents/other.json',
    'bun install',
    'bun node_modules/.bin/vulcan project sync',
    'bun node_modules/.bin/vulcan project sync --app apps/web',
    'perl -e 1 .agents/local/vulcan.manifest.json',
  ])('a command that does not change one is left alone: %s', (command) => {
    expect(protectedHitsOf({ root, command })).toEqual([]);
  });

  test('a path the guard cannot work out is not taken for a protected file by a removal', () => {
    expect(protectedHitsOf({ root, command: 'rm "$UNKNOWN"' })).toEqual([]);
  });
});

describe('the modules under .configs/ a config imports are protected like the config', () => {
  const root = project();
  const configModules = ['.configs/policy.mts', '.configs/shared/doctor.mts'];
  const hitsOf = (opts: { command?: string; tool?: string; filePath?: string }) =>
    OutsideGuard.inspect({
      input: {
        tool: opts.tool ?? 'Bash',
        command: opts.command,
        cwd: root,
        filePath: opts.filePath,
      },
      projectRoot: root,
      configModules,
      env: { HOME: '/nonexistent-home' },
    }).filter((hit) => hit.isProtected === true);

  test.each(configModules.flatMap((path) => FORMS.map(([form, make]) => ({ path, form, make }))))(
    '$form on $path',
    ({ path, make }) => {
      expect(hitsOf({ command: make(path) }).length).toBeGreaterThan(0);
    },
  );

  test.each(['Edit', 'Write', 'MultiEdit'])('the %s tool on one is denied', (tool) => {
    for (const path of configModules) {
      expect(hitsOf({ tool, filePath: join(root, path) }).length, path).toBeGreaterThan(0);
    }
  });

  test.each(['rm -rf .configs/shared', 'rm .configs/*.mts', 'rm .configs/shared/*'])(
    'a folder or a pattern that reaches one is denied: %s',
    (command) => {
      expect(hitsOf({ command }).length).toBeGreaterThan(0);
    },
  );

  test('a module the manifest does not list is not protected', () => {
    expect(hitsOf({ command: 'echo x > .configs/lints/eslint.config.mts' })).toEqual([]);
    expect(
      OutsideGuard.inspect({
        input: {
          tool: 'Bash',
          command: 'echo x > .configs/policy.mts',
          cwd: root,
          filePath: undefined,
        },
        projectRoot: root,
        env: { HOME: '/nonexistent-home' },
      }).filter((hit) => hit.isProtected === true),
    ).toEqual([]);
  });
});

describe('the hook answers with a deny, whatever the project sets', () => {
  const answerOf = (opts: { root: string; stdin: string; env?: Record<string, string> }) => {
    const environment: Record<string, string | undefined> = {
      ...process.env,
      CLAUDE_PROJECT_DIR: opts.root,
      ...opts.env,
    };

    delete environment.VULCAN_GUARDS;
    delete environment.VULCAN_GUARD_ASKS;
    delete environment.VULCAN_GUARD_OUTSIDE;

    const result = spawnSyncBounded({
      cmd: [process.execPath, HOOK],
      cwd: opts.root,
      env: { ...environment, ...opts.env },
      stdin: new Blob([opts.stdin]),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const text = result.stdout.toString().trim();
    const parsed: unknown = text === '' ? undefined : JSON.parse(text);
    const specific =
      typeof parsed === 'object' && parsed !== null && 'hookSpecificOutput' in parsed
        ? parsed.hookSpecificOutput
        : undefined;

    return {
      text,
      decision:
        typeof specific === 'object' && specific !== null && 'permissionDecision' in specific
          ? specific.permissionDecision
          : undefined,
    };
  };

  test.each(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])(
    'a %s of each protected file is denied, and the reason says the owner changes it',
    (tool) => {
      const root = project();

      for (const path of PROTECTED) {
        const result = answerOf({
          root,
          stdin: fileToolEvent({ tool, path: join(root, path), cwd: root }),
        });

        expect(result.decision, path).toBe('deny');
        expect(result.text, path).toContain('changed by the owner');
      }
    },
  );

  test.each([
    'echo x > .agents/local/vulcan.manifest.json',
    "sed -i 's/deny/ask/' .agents/local/vulcan.manifest.json",
    'rm .agents/local/vulcan.manifest.json',
    'echo x | tee .claude/settings.local.json',
    'cp other .configs/vulcan.config.mts',
    'mv other node_modules/@venizia/vulcan/base/hooks/guard-git.ts',
    'truncate -s 0 node_modules/@venizia/vulcan/base/hooks/guard-outside.ts',
  ])('a Bash call that changes one is denied: %s', (command) => {
    const root = project();
    const result = answerOf({
      root,
      stdin: toolEvent({ tool: 'Bash', input: { command }, cwd: root }),
    });

    expect(result.decision).toBe('deny');
    expect(result.text).toContain('V-B-08');
  });

  test('with guard.outside and guard.asks both set to ask, it is still a deny', () => {
    const root = createProject({
      files: {
        'package.json': '{}',
        '.agents/local/vulcan.manifest.json': JSON.stringify({
          guard: { outside: 'ask', asks: 'ask' },
        }),
      },
    });
    const result = answerOf({
      root,
      stdin: toolEvent({
        tool: 'Bash',
        input: { command: "sed -i 's/deny/ask/' .agents/local/vulcan.manifest.json" },
        cwd: root,
      }),
    });

    expect(result.decision).toBe('deny');
  });

  test('guard.toolOwnedPaths cannot open a protected file', () => {
    const root = createProject({
      files: {
        'package.json': '{}',
        '.agents/local/vulcan.manifest.json': JSON.stringify({ guard: { toolOwnedPaths: ['**'] } }),
      },
    });

    expect(
      answerOf({
        root,
        stdin: fileToolEvent({
          tool: 'Write',
          path: join(root, '.claude/settings.json'),
          cwd: root,
        }),
      }).decision,
    ).toBe('deny');
  });

  test('a file next to a protected one is not held', () => {
    const root = project();

    expect(
      answerOf({
        root,
        stdin: fileToolEvent({ tool: 'Write', path: join(root, '.claude/notes.md'), cwd: root }),
      }).text,
    ).toBe('');
  });
});
