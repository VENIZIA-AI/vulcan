import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { inspectOutside } from '../../hooks/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const HOME = createProject({ files: {} });
const ENV = { HOME, XDG_RUNTIME_DIR: join(HOME, 'run'), BUN_INSTALL: join(HOME, '.bun') };
const PROJECT = createProject({ files: { 'package.json': '{}' } });

const bash = (opts: { command: string; cwd?: string; toolOwnedPaths?: string[] }): string[] =>
  inspectOutside({
    input: { tool: 'Bash', filePath: undefined, command: opts.command, cwd: opts.cwd ?? PROJECT },
    projectRoot: PROJECT,
    toolOwnedPaths: opts.toolOwnedPaths,
    home: HOME,
    env: ENV,
  }).map((hit) => hit.message);

const file = (opts: { tool: string; path: string }): string[] =>
  inspectOutside({
    input: { tool: opts.tool, filePath: opts.path, command: undefined, cwd: PROJECT },
    projectRoot: PROJECT,
    home: HOME,
    env: ENV,
  }).map((hit) => hit.message);

describe('inspectOutside flags', () => {
  test.each([
    'mkdir /tmp/scratch',
    'touch ~/notes.txt',
    'echo hi > /tmp/out.txt',
    'cp a.txt /tmp/a.txt',
    'mv a.txt ../elsewhere/a.txt',
    'cat x | tee /tmp/x',
    'curl -o /tmp/x.tgz https://example.test/x.tgz',
    'wget -P /tmp https://example.test/x',
    'git clone https://example.test/r.git /tmp/r',
    'git worktree add ../wt -b topic',
    'git worktree add -b topic ../wt',
    'mktemp',
    'mktemp -d',
    'mktemp /tmp/work.XXXX',
    'mktemp -p /tmp',
    'TMPDIR=/tmp bun test',
    'FOO=1 TMPDIR=/var/tmp make',
    'dd if=a of=/tmp/b',
    'cd x && echo 1 > /tmp/y',
    `bash -c 'mkdir /tmp/z'`,
  ])('%s', (command) => {
    expect(bash({ command }).length).toBeGreaterThan(0);
  });

  test.each(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])('%s outside the project', (tool) => {
    expect(file({ tool, path: '/tmp/x.md' }).length).toBe(1);
  });

  test('a path through a symlink that leaves the project', () => {
    const outside = createProject({ files: {} });

    symlinkSync(outside, join(PROJECT, 'link'));

    expect(bash({ command: 'touch link/new.txt' }).length).toBeGreaterThan(0);
  });
});

describe('inspectOutside flags what a review found', () => {
  test.each([
    'curl -sLo /etc/x https://example.test/u',
    'wget -qO /etc/x https://example.test/u',
    'curl --output-dir /etc -O https://example.test/u',
    'cp -t /etc/ a',
    'mv -t /etc a',
    'git clone -b main https://example.test/r.git /etc/x',
    'git clone --depth 1 https://example.test/r.git /etc/x',
    'git -C /etc clone https://example.test/r.git',
    'git -C /etc worktree add y',
    'cd /etc && touch x',
    'cd /etc; mkdir y',
    'mktemp -t foo',
    'export TMPDIR=/tmp',
    'bash -lc "touch /etc/x"',
    '{ touch /etc/x; }',
    'if true; then touch /etc/x; fi',
    'xargs touch /etc/x',
    'env -u HOME touch /etc/x',
    'env -S "touch /etc/x"',
  ])('%s', (command) => {
    expect(bash({ command }).length).toBeGreaterThan(0);
  });

  test('a dangling symlink that points outside the project counts as outside', () => {
    symlinkSync('/nonexistent-vulcan-target/dir', join(PROJECT, 'dangling'));

    expect(bash({ command: 'touch dangling/new.txt' }).length).toBeGreaterThan(0);
  });

  test('cd into the project and out again tracks the directory', () => {
    mkdirSync(join(PROJECT, 'inner'), { recursive: true });

    expect(bash({ command: 'cd inner && touch a.txt' })).toEqual([]);
    expect(bash({ command: 'cd inner && cd .. && touch a.txt' })).toEqual([]);
    expect(bash({ command: 'cd inner && cd /etc && touch a.txt' }).length).toBeGreaterThan(0);
  });
});

describe('inspectOutside passes', () => {
  test.each([
    'mkdir -p .agents/local/tmp/a',
    'echo hi > out.txt',
    'cp a.txt b.txt',
    'git worktree add .agents/local/worktrees/topic -b topic',
    'git clone https://example.test/r.git .agents/local/clones/r',
    'mktemp -d -p .agents/local/tmp',
    'mktemp .agents/local/tmp/work.XXXX',
    'TMPDIR=.agents/local/tmp bun test',
    'echo hi > /dev/null',
    'make build 2>&1 | tee build.log',
    'ls /tmp',
    'cat /etc/hosts',
    'git status',
    'echo "write to /tmp/x is a bad idea"',
    'grep -rn mkdir /tmp',
    'bun install',
    'cp ~/.bun/bin/x ./x',
  ])('%s', (command) => {
    expect(bash({ command })).toEqual([]);
  });

  test('a file tool inside the project', () => {
    expect(file({ tool: 'Write', path: join(PROJECT, 'src/a.ts') })).toEqual([]);
    expect(file({ tool: 'Write', path: join(PROJECT, '.agents/local/reports/r.md') })).toEqual([]);
  });

  test('a read tool is not inspected', () => {
    expect(file({ tool: 'Read', path: '/tmp/x.md' })).toEqual([]);
  });

  test('a relative path resolves against the hook cwd, so a cwd inside the project is inside', () => {
    mkdirSync(join(PROJECT, 'sub'), { recursive: true });

    expect(bash({ command: 'touch a.txt', cwd: join(PROJECT, 'sub') })).toEqual([]);
  });
});

describe('the tool-owned allowlist', () => {
  test.each([
    `touch ${join(HOME, '.bun/install/cache/x')}`,
    `touch ${join(HOME, '.npm/_logs/x.log')}`,
    `touch ${join(HOME, 'run/bun.lock')}`,
  ])('defaults allow %s', (command) => {
    expect(bash({ command })).toEqual([]);
  });

  test.each([
    `touch ${join(HOME, '.bun/bin/x')}`,
    `echo a >> ${join(HOME, '.gitconfig')}`,
    `cp a ${join(HOME, '.config/git/hooks/pre-commit')}`,
    `touch ${join(HOME, '.yarn/bin/x')}`,
    `touch ${join(HOME, '.npm/_npx/x')}`,
  ])('the defaults do not allow a place that runs code: %s', (command) => {
    expect(bash({ command }).length).toBeGreaterThan(0);
  });

  test('the agent tool memory folder is allowed, the rest of its config folder is not', () => {
    const memory = join(HOME, '.claude/projects/p/memory/note.md');
    const settings = join(HOME, '.claude/settings.json');

    expect(file({ tool: 'Write', path: memory })).toEqual([]);
    expect(file({ tool: 'Write', path: settings }).length).toBe(1);
  });

  test('guard.toolOwnedPaths extends the defaults', () => {
    const store = join(HOME, 'custom-store');

    expect(bash({ command: `touch ${store}/a` }).length).toBe(1);
    expect(bash({ command: `touch ${store}/a`, toolOwnedPaths: [`${store}/**`] })).toEqual([]);
    expect(bash({ command: `touch ${store}/a`, toolOwnedPaths: ['~/custom-store'] })).toEqual([]);
  });

  test('a pattern with an unset variable allows nothing, instead of everything', () => {
    expect(bash({ command: 'touch /tmp/x', toolOwnedPaths: ['$NOT_SET/**'] }).length).toBe(1);
  });

  test('the system temp directory is never exempt, TMPDIR and mktemp included', () => {
    expect(bash({ command: 'TMPDIR=/tmp bun test' }).length).toBe(1);
    expect(bash({ command: 'mktemp -d' }).length).toBe(1);
  });
});
