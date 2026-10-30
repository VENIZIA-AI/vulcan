import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, symlinkSync } from 'node:fs';
import { join, relative } from 'node:path';
import { inspectOutside } from '../../hooks/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const HOME = createProject({ files: {} });
const ENV = { HOME, XDG_RUNTIME_DIR: join(HOME, 'run'), BUN_INSTALL: join(HOME, '.bun') };
const PROJECT = createProject({ files: { 'package.json': '{}' } });

const bash = (opts: {
  command: string;
  cwd?: string;
  toolOwnedPaths?: string[];
  env?: Record<string, string | undefined>;
}): string[] =>
  inspectOutside({
    input: { tool: 'Bash', filePath: undefined, command: opts.command, cwd: opts.cwd ?? PROJECT },
    projectRoot: PROJECT,
    toolOwnedPaths: opts.toolOwnedPaths,
    home: HOME,
    env: opts.env ?? ENV,
  }).map((hit) => hit.message);

const file = (opts: { tool: string; path: string }): string[] =>
  inspectOutside({
    input: { tool: opts.tool, filePath: opts.path, command: undefined, cwd: PROJECT },
    projectRoot: PROJECT,
    home: HOME,
    env: ENV,
  }).map((hit) => hit.message);

describe('mktemp where the temp folder is inside the project', () => {
  // Claude Code: the session-start hook exports TMPDIR into every Bash command, so a bare mktemp lands in the project.
  const inClaudeCode = { ...ENV, CLAUDE_PROJECT_DIR: PROJECT };

  test.each(['mktemp', 'mktemp -d', 'mktemp -t foo', 'mktemp -d -t work.XXXX'])(
    '%s is not asked about while the session-start hook route is in force',
    (command) => {
      expect(bash({ command, env: inClaudeCode })).toEqual([]);
    },
  );

  test.each([
    'mktemp /tmp/work.XXXX',
    'mktemp -p /tmp',
    'mktemp -d --tmpdir=/var/tmp',
    'TMPDIR=/tmp mktemp -d',
    'export TMPDIR=/tmp',
  ])('%s still asks: the path is chosen by hand', (command) => {
    expect(bash({ command, env: inClaudeCode }).length).toBe(1);
  });

  test('outside Claude Code (no CLAUDE_PROJECT_DIR, no TMPDIR) a bare mktemp asks, as before', () => {
    expect(bash({ command: 'mktemp -d' }).length).toBe(1);
  });

  test('a TMPDIR inside the project (the launch route) is the folder mktemp uses; one outside is not', () => {
    expect(
      bash({ command: 'mktemp -d', env: { ...ENV, TMPDIR: join(PROJECT, '.agents/local/tmp') } }),
    ).toEqual([]);
    expect(bash({ command: 'mktemp -d', env: { ...ENV, TMPDIR: '/var/tmp' } }).length).toBe(1);
  });
});

describe('inspectOutside on a line it cannot read in full', () => {
  test('asks, never allows', () => {
    const wide = Array.from({ length: 2100 }, () => 'ls').join('; ');

    expect(bash({ command: wide }).join(' ')).toContain('larger, or nests deeper');
    expect(bash({ command: `env${' -S env'.repeat(110)} touch x` }).join(' ')).toContain(
      'larger, or nests deeper',
    );
    expect(bash({ command: 'ls' })).toEqual([]);
  });
});

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

describe('$PWD is the folder the command runs in', () => {
  const DEEP = join(PROJECT, 'a', 'b');

  mkdirSync(DEEP, { recursive: true });

  test.each([
    { command: 'export TMPDIR=$PWD/x', name: '$PWD and a folder' },
    { command: 'export TMPDIR=${PWD}/x', name: '${PWD} and a folder' },
    { command: 'export TMPDIR=$PWD/../x', name: 'one step up that stays in the project' },
    { command: 'export TMPDIR=$PWD/../../.agents/local/tmp', name: 'two steps up, still inside' },
  ])('$name passes from a subfolder', ({ command }) => {
    expect(bash({ command, cwd: DEEP })).toEqual([]);
  });

  test.each([
    {
      command: 'export TMPDIR=$PWD/../../../x',
      cwd: DEEP,
      name: 'three steps up from a/b, one past the project',
    },
    { command: 'export TMPDIR=${PWD}/../../../../x', cwd: DEEP, name: 'four steps up from a/b' },
    { command: 'cd a && export TMPDIR=$PWD/../../x', cwd: PROJECT, name: '$PWD after a cd' },
  ])('$name asks, once', ({ command, cwd }) => {
    expect(bash({ command, cwd })).toEqual(['TMPDIR points outside the project']);
  });

  test('the PWD of the hook process does not decide the path', () => {
    expect(bash({ command: 'export TMPDIR=$PWD/x', cwd: DEEP, env: { ...ENV, PWD: '/' } })).toEqual(
      [],
    );
    expect(
      bash({ command: 'export TMPDIR=$PWD/../../../x', cwd: DEEP, env: { ...ENV, PWD: PROJECT } }),
    ).toEqual(['TMPDIR points outside the project']);
  });

  test('git -C moves the folder of a relative word, not $PWD', () => {
    const env = { ...ENV, PWD: PROJECT };

    expect(bash({ command: 'git -C a clone https://x/y $PWD/../x', env }).length).toBe(1);
    expect(bash({ command: 'git -C a worktree add $PWD/../x', env }).length).toBe(1);
    expect(bash({ command: 'git -C a clone https://x/y $PWD/x', env })).toEqual([]);
  });

  test('without a cwd in the payload the PWD of the hook is still the fallback', () => {
    const inspect = (opts: { pwd: string }) =>
      inspectOutside({
        input: { tool: 'Bash', filePath: undefined, command: 'touch $PWD/x', cwd: undefined },
        projectRoot: PROJECT,
        home: HOME,
        env: { ...ENV, PWD: opts.pwd },
      });

    expect(inspect({ pwd: '/var/tmp' }).length).toBe(1);
    expect(inspect({ pwd: PROJECT })).toEqual([]);
  });

  test('a cwd given relative is resolved once, not twice', () => {
    expect(bash({ command: 'export TMPDIR=$PWD/x', cwd: relative(process.cwd(), DEEP) })).toEqual(
      [],
    );
  });

  test('a loop of links in the working folder is not followed for ever', () => {
    symlinkSync(join(PROJECT, 'loop2'), join(PROJECT, 'loop1'));
    symlinkSync(join(PROJECT, 'loop1'), join(PROJECT, 'loop2'));

    expect(() => bash({ command: 'touch $PWD/x', cwd: join(PROJECT, 'loop1') })).not.toThrow();
  });

  test('another variable or a command substitution is still not worked out, and passes as before', () => {
    expect(bash({ command: 'export TMPDIR=$NOPE/x', cwd: DEEP })).toEqual([]);
    expect(bash({ command: 'export TMPDIR=$(pwd)/../../../x', cwd: DEEP })).toEqual([]);
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

describe('the agent tool scratchpad', () => {
  const SCRATCHPAD =
    '/tmp/claude-1000/-home-user-project/0b1c2d3e-aaaa-bbbb-cccc-1234567890ab/scratchpad';
  const hitsOf = (opts: { command?: string; tool?: string; path?: string }) =>
    inspectOutside({
      input: {
        tool: opts.tool ?? 'Bash',
        filePath: opts.path,
        command: opts.command,
        cwd: PROJECT,
      },
      projectRoot: PROJECT,
      home: HOME,
      env: ENV,
    });

  test('a redirect after cd into the scratchpad is flagged as the scratchpad', () => {
    const hits = hitsOf({ command: `cd ${SCRATCHPAD} && gh api repos/x/y/contents/z > out.ts` });

    expect(hits.length).toBe(1);
    expect(hits[0]?.isAgentToolScratchpad).toBe(true);
  });

  test('a file tool writing into the scratchpad is flagged', () => {
    const hits = hitsOf({ tool: 'Write', path: `${SCRATCHPAD}/notes.md` });

    expect(hits.map((hit) => hit.isAgentToolScratchpad)).toEqual([true]);
  });

  test('the folder itself, not only what is below it, is the scratchpad', () => {
    expect(
      hitsOf({ command: `mkdir ${SCRATCHPAD}` }).map((hit) => hit.isAgentToolScratchpad),
    ).toEqual([true]);
  });

  test.each([
    'mkdir /tmp/other-work',
    'touch /tmp/claude-notes/a',
    'mkdir /var/tmp/claude-1000/x',
    'touch /tmp/claude-1000/-home-user-project/0b1c2d3e/tasks/out',
  ])('%s is outside the project but not the scratchpad, so it is only asked about', (command) => {
    const hits = hitsOf({ command });

    expect(hits.length).toBe(1);
    expect(hits[0]?.isAgentToolScratchpad).toBe(false);
  });

  test('a guard.toolOwnedPaths entry for the folder keeps allowing it (the owner chose it)', () => {
    const hits = inspectOutside({
      input: {
        tool: 'Write',
        filePath: `${SCRATCHPAD}/notes.md`,
        command: undefined,
        cwd: PROJECT,
      },
      projectRoot: PROJECT,
      toolOwnedPaths: ['/tmp/claude-*/**'],
      home: HOME,
      env: ENV,
    });

    expect(hits).toEqual([]);
  });

  test('a path inside the project is not flagged', () => {
    expect(hitsOf({ command: 'mkdir -p .agents/local/tmp/x' })).toEqual([]);
  });
});
