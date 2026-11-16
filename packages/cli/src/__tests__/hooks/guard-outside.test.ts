import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { OutsideGuard } from '../../hooks/index.ts';
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
  OutsideGuard.inspect({
    input: { tool: 'Bash', filePath: undefined, command: opts.command, cwd: opts.cwd ?? PROJECT },
    projectRoot: PROJECT,
    toolOwnedPaths: opts.toolOwnedPaths,
    home: HOME,
    env: opts.env ?? ENV,
  }).map((hit) => hit.message);

const file = (opts: { tool: string; path: string }): string[] =>
  OutsideGuard.inspect({
    input: { tool: opts.tool, filePath: opts.path, command: undefined, cwd: PROJECT },
    projectRoot: PROJECT,
    home: HOME,
    env: ENV,
  }).map((hit) => hit.message);

describe('a shell that reads its commands from stdin is followed', () => {
  test.each([
    'bash <<< "echo x > /tmp/y"',
    String.raw`printf 'echo x > /tmp/y\n' | sh`,
    'echo cp a /etc/passwd | sh',
    "printf '%s ' cp a /etc/passwd | sh",
    "cat <<'EOF' | sh\necho x > /tmp/y\nEOF",
    'find . -name x -exec cp {} /tmp/y \\;',
  ])('%s asks about the file outside the project', (command) => {
    expect(bash({ command }).length).toBeGreaterThan(0);
  });

  test.each(['bash <<< "echo x > out.txt"', String.raw`printf 'ls\n' | sh`])(
    '%s writes inside the project and stays quiet',
    (command) => {
      expect(bash({ command })).toEqual([]);
    },
  );
});

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

describe('OutsideGuard.inspect on a line it cannot read in full', () => {
  test('asks, never allows', () => {
    const wide = Array.from({ length: 2100 }, () => 'ls').join('; ');

    expect(bash({ command: wide }).join(' ')).toContain('larger, or nests deeper');
    expect(bash({ command: `env${' -S env'.repeat(110)} touch x` }).join(' ')).toContain(
      'larger, or nests deeper',
    );
    expect(bash({ command: 'ls' })).toEqual([]);
  });
});

describe('OutsideGuard.inspect flags', () => {
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

describe('OutsideGuard.inspect flags what a review found', () => {
  test.each([
    'curl -sLo /etc/x https://example.test/u',
    'wget -qO /etc/x https://example.test/u',
    'curl --output-dir /etc -O https://example.test/u',
    'cp -t /etc/ a',
    'echo x 1<>/etc/zz',
    'echo x <>/etc/zz',
    'cat a <> /etc/zz',
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

  test('a cd inside a subshell stays in it, and pushd and popd move like cd', () => {
    expect(bash({ command: '(cd /etc; touch a.txt)' }).length).toBeGreaterThan(0);
    expect(bash({ command: '(cd /etc; true); touch a.txt' })).toEqual([]);
    expect(bash({ command: 'pushd /etc && touch a.txt' }).length).toBeGreaterThan(0);
    expect(bash({ command: 'pushd /etc && popd && touch a.txt' })).toEqual([]);
    expect(
      bash({ command: 'cd /etc && case x in a) true;; esac && touch a.txt' }).length,
    ).toBeGreaterThan(0);
  });
});

describe('OutsideGuard.inspect passes', () => {
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
      OutsideGuard.inspect({
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
    OutsideGuard.inspect({
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
    const hits = OutsideGuard.inspect({
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

describe('OutsideGuard.inspect reads the command after a line that only looks like a heredoc start', () => {
  test.each(['# feed <<STOP to the reader', 'echo $(( 2 << n ))', 'printf "%s" "first\n<<STOP"'])(
    'after %s, a write outside the project asks',
    (lead) => {
      expect(bash({ command: `${lead}\necho hi > /tmp/out.txt` }).length).toBe(1);
    },
  );

  test('a write outside the project inside a real heredoc body is data; a line it cannot follow asks', () => {
    expect(bash({ command: "cat > notes.md <<'STOP'\necho hi > /tmp/out.txt\nSTOP" })).toEqual([]);
    expect(bash({ command: 'echo "never closed\nls' }).join(' ')).toContain('does not close');
  });
});

describe('OutsideGuard.inspect follows a link before a .. and sees more write targets', () => {
  const OUTSIDE = createProject({ files: { 'dir/keep': '' } });

  mkdirSync(join(PROJECT, 'real/sub'), { recursive: true });
  symlinkSync(join(OUTSIDE, 'dir'), join(PROJECT, 'out-link'));
  symlinkSync(join(PROJECT, 'real'), join(PROJECT, 'in-link'));

  // A `..` after a link goes to the parent of the link's target, as the OS opens it, not to the parent of the link.
  test.each([
    'echo x > out-link/../probe',
    'mkdir -p out-link/../made',
    'touch out-link/sub/../../probe',
    'cd out-link && echo x > ../probe',
    'cd out-link && touch ../probe',
  ])('%s asks', (command) => {
    expect(bash({ command }).length).toBeGreaterThan(0);
  });

  test.each([
    'echo x > real/../fine',
    'echo x > in-link/../fine',
    'cd in-link && echo x > ../fine',
    'touch real/sub/../ok',
  ])('%s stays silent: it lands in the project', (command) => {
    expect(bash({ command })).toEqual([]);
  });

  test.each([
    'echo x >&/etc/probe',
    'echo x >& /etc/probe',
    'echo x >&${HOME}/../probe',
    'ls >& /tmp/probe.log',
  ])('%s asks: >&file writes the file', (command) => {
    expect(bash({ command }).length).toBeGreaterThan(0);
  });

  test.each([
    'echo x >&2',
    'echo x >& 2',
    'echo x 2>&1',
    'echo x >&-',
    'echo x >&2 | cat',
    'echo x >&out.txt',
  ])('%s stays silent: a descriptor, or a file in the project', (command) => {
    expect(bash({ command })).toEqual([]);
  });

  // The value of an option can be attached to it, alone or at the end of a cluster.
  test.each([
    'cp a -t/etc',
    'cp -vt/etc a',
    'cp --target-directory=/etc a',
    'install -t/etc a',
    'install -D -m755 -t /etc a',
    'curl -o/etc/x https://example.test/u',
    'curl -sLo/etc/x https://example.test/u',
    'curl -sLo /etc/x https://example.test/u',
    'wget -O/etc/x https://example.test/u',
    'wget -P/etc https://example.test/u',
    'mktemp -p/etc',
  ])('%s asks', (command) => {
    expect(bash({ command }).length).toBeGreaterThan(0);
  });

  // An option that takes a value, after the destination, is not the destination.
  test.each([
    'rsync -av src /etc/dest --exclude x',
    'rsync src /etc/dest -e ssh',
    'rsync src /etc/dest --exclude-from list.txt --delete',
    'cp a /etc/dest -S .bak',
    'cp a /etc/dest --suffix .bak',
    'install a /etc/dest -m 755',
    'ln -s a /etc/l -S .bak',
    'cp -- a /etc/dest',
  ])('%s asks', (command) => {
    expect(bash({ command }).length).toBeGreaterThan(0);
  });

  test.each([
    'rsync -av /etc/src dest --exclude x',
    'rsync -rt src dest',
    'cp -S .bak a b',
    'cp -S.bak a b',
    'cp -r a b',
    'curl -d ofile https://example.test/u',
    'curl -H x -ofile https://example.test/u',
    'wget -O- https://example.test/u',
  ])('%s stays silent: it writes inside the project', (command) => {
    expect(bash({ command })).toEqual([]);
  });

  test.each([
    'pushd /etc && touch x',
    'builtin cd /etc && touch x',
    'command builtin cd /etc && touch x',
    'builtin pushd /etc; touch x',
    'pushd -- /etc && touch x',
  ])('%s asks: the write is in the folder the builtin moved to', (command) => {
    expect(bash({ command }).length).toBeGreaterThan(0);
  });
});

describe('OutsideGuard.inspect asks when it cannot tell where a write lands', () => {
  symlinkSync(join(PROJECT, 'spin2'), join(PROJECT, 'spin1'));
  symlinkSync(join(PROJECT, 'spin1'), join(PROJECT, 'spin2'));

  test.each([
    // `>&word` is a descriptor or a file; with an expansion in it the line does not say which.
    'fd=/etc/f; echo x >&$fd',
    'echo x >&${fd}',
    'echo x 1<>/etc/zz',
    'echo x <>/etc/zz',
    // A path through more links than the system follows has no file.
    'touch spin1/x',
    'echo x > spin2/y',
    // `/proc/self` and `/dev/fd` name the hook's own process, not the shell the command runs in.
    'echo x > /dev/fd/3',
    'echo x > /proc/self/fd/1',
    'echo x > /proc/self/cwd/zz',
    // The destination before an option the table does not know: what follows may be its value.
    'cp a /etc/zz --sparse never',
    'cp a /etc/zz --suff .bak',
    'mv a /etc/zz --suff .bak',
    'install a /etc/zz --own root',
    'rsync a /etc/zz --zl 3',
    // A long option written short, as getopt reads it.
    'wget --output-doc /etc/zz https://example.test/u',
    'curl --out /etc/zz https://example.test/u',
    'cp --target-dir /etc a',
    'cp --t /etc a',
    'mv --t /etc a',
    'install --t /etc a',
  ])('%s asks', (command) => {
    expect(bash({ command }).length).toBeGreaterThan(0);
  });

  test.each([
    'echo x >&2',
    'echo x >&-',
    'echo x > /dev/null',
    'rsync -a src dest --delete --progress',
    'cp a b --force',
    'cp /etc/hosts here --force',
    'cp a b --sparse=never',
    'ln -s a b --relative',
  ])('%s stays silent', (command) => {
    expect(bash({ command })).toEqual([]);
  });
});

describe('OutsideGuard.inspect on a path that names the hook process', () => {
  test('/proc/self/cwd lands in the project when the hook runs there, and still asks: the shell may be elsewhere', () => {
    const before = process.cwd();

    process.chdir(PROJECT);

    try {
      expect(bash({ command: 'cd /etc && echo x > /proc/self/cwd/zz' }).length).toBeGreaterThan(0);
      expect(bash({ command: 'echo x > /proc/thread-self/cwd/zz' }).length).toBeGreaterThan(0);
    } finally {
      process.chdir(before);
    }
  });
});

describe('a redirect to a name with a [...] in it', () => {
  // the pattern is a glob: a match is written through, so only a pattern that matches nothing names the file as written
  const outside = join(HOME, 'bracket-outside');

  mkdirSync(outside, { recursive: true });

  for (const folder of ['content/changelogs/upgrade', 'docs', 'pages']) {
    mkdirSync(join(PROJECT, folder), { recursive: true });
  }

  writeFileSync(join(outside, 'target.md'), 'x');
  symlinkSync(join(outside, 'target.md'), join(PROJECT, 'v.md'));
  symlinkSync(outside, join(PROJECT, 'linked'));
  symlinkSync(join(outside, 'target.md'), join(PROJECT, 'docs', 'w.md'));
  mkdirSync(join(PROJECT, 'case'), { recursive: true });
  symlinkSync(join(outside, 'target.md'), join(PROJECT, 'case', 'V.md'));

  test.each([
    'echo x > content/changelogs/upgrade/[version].md',
    'echo x >> docs/[id].md',
    'cat a > pages/[...slug].md',
    'echo x > [id].md',
    'echo x > ./[id].md',
  ])('%s names a file inside the project and stays quiet', (command) => {
    expect(bash({ command })).toEqual([]);
  });

  test.each([
    // a match is written through a symlink to a file outside the project
    'echo x > [v].md',
    'echo x >| [v].md',
    'echo x &> [v].md',
    'echo x 2> [v].md',
    'cat <<< x > [v].md',
    'echo x > ./[v].md',
    'echo x > docs/[w].md',
    // bash nocaseglob matches V.md for [v].md
    'shopt -s nocaseglob; echo x > case/[v].md',
    'echo x > case/[v].md',
    'echo x > [v].md > b.md',
    // a negated class, and a zsh glob qualifier, are not a plain name
    'echo x > [!a].md',
    "echo x > [a](e:'cd;REPLY=x':)",
    'echo x > [a](:a:h:h:s:x:y:)',
    'echo x > [a](:h)',
    // a link to a folder outside the project, a missing folder, an absolute path, a `..`
    'echo x > linked/[id].md',
    'echo x > nowhere/[id].md',
    'echo x > /etc/[version].md',
    'echo x > ../outside/[version].md',
    'echo x > content/../[v].md',
    // the folder, an expansion or a second glob decides
    'echo x > [a]/x.md',
    'echo x > [version]*.md',
    'echo x > $NOPE_UNSET/[version].md',
    'echo x > ~root/[version].md',
  ])('%s still asks', (command) => {
    expect(bash({ command }).length).toBeGreaterThan(0);
  });
});

describe('OutsideGuard.inspect asks about a redirect to a word it cannot work out', () => {
  test.each([
    'f=/etc/x; echo x > $f',
    'echo x &>$fd',
    'echo x > $NOPE_UNSET/zz',
    'echo x > *.log',
    'echo x >> ${LOG}',
    'echo x > $(mktemp)',
    // `~name` is that user's home, which is outside the project.
    'echo x > ~root/zz',
    'mkdir ~root/x',
    'cp a ~root/',
  ])('%s asks', (command) => {
    expect(bash({ command }).length).toBeGreaterThan(0);
  });

  test.each([
    'echo x > out.txt',
    'echo x >&2',
    'echo x > /dev/null',
    'echo x > "$PWD/out.txt"',
    'echo x > ~+/out.txt',
    // A name the password file does not list stays a plain path, as bash leaves it; so does `~-`.
    'echo x > ~no-such-user-zz/zz',
    'echo x > ~-/zz',
    'mkdir ~no-such-user-zz',
    'echo x 2>&1',
    'cat < in.txt',
  ])('%s stays silent: a file in the project, or a descriptor', (command) => {
    expect(bash({ command }).filter((message) => message.includes('expansion'))).toEqual([]);
  });
});

describe('an input redirect on a compound command is not a program', () => {
  test.each(['{ read -r A; } < "$S"', 'while read -r A; do echo "$A"; done < "$S"'])(
    '%s asks about nothing',
    (command) => {
      expect(bash({ command })).toEqual([]);
    },
  );

  test('a program named by a variable after the compound command still asks', () => {
    expect(bash({ command: 'while read -r A; do :; done < "$S"; $CMD' })).not.toEqual([]);
  });
});

describe('a plain variable set earlier on the same line, in the same shell', () => {
  test.each([
    'T=out; echo x > $T/log',
    'f=out/x; echo x > ${f}',
    'f=ok; (echo x > $f)',
    'f=a; g=b; echo x > $f/$g',
  ])('%s is worked out and passes inside the project', (command) => {
    expect(bash({ command })).toEqual([]);
  });

  test('a value that points outside asks, naming the path it works out', () => {
    const hits = bash({ command: 'f=../outside/x; echo x > $f' });

    expect(hits).toHaveLength(1);
    expect(hits[0]).not.toContain('cannot work out');
  });

  test.each([
    ['assigned twice', 'f=../x; f=ok; echo x > $f'],
    ['bound by a for loop', 'f=ok; for f in ../x; do echo x > $f; done'],
    ['bound by read', 'f=ok; read f; echo x > $f'],
    ['bound by printf -v', 'f=ok; printf -v f ../x; echo x > $f'],
    ['bound through eval', 'f=ok; eval "f=../x"; echo x > $f'],
    ['set in a subshell, used outside it', '(f=ok); echo x > $f'],
    ['set in a stage of a pipeline', 'f=ok | cat; echo x > $f'],
    ['a value with an expansion', 'f=$HOME/x; echo x > $f'],
    ['a value with a space', 'f="a b"; echo x > $f'],
    ['set for one command only', 'f=ok cat > $f'],
    ['copied through a variable that is set later', 'g=$f; f=ok; echo x > $g'],
    ['copied through a variable that is set twice', 'f=ok; f=../x; g=$f; echo x > $g'],
    ['exported, then set again', 'f=ok; export f; f=../x; echo x > $f'],
    ['a loop variable set inside the loop', 'for f in a b; do f=../x; echo x > $f; done'],
    ['a loop variable read into', 'for f in a b; do read f; echo x > $f; done'],
    ['a loop variable set through eval', 'for f in a b; do eval "f=../x"; echo x > $f; done'],
    ['a loop variable used after the loop', 'for f in a b; do :; done; echo x > $f'],
    ['a loop over a glob', 'for f in *.md; do echo x > $f.bak; done'],
    ['a loop over a substitution', 'for f in $(ls); do echo x > $f; done'],
    ['a loop over words with an expansion', 'for f in a $HOME; do echo x > $f; done'],
    ['a loop in another shell', "for f in a b; do sh -c 'echo x > $f'; done"],
    ['a loop that reads its lines', 'while read f; do echo x > $f; done < list'],
    [
      'two loops whose values multiply past what the guard follows',
      `for i in ${Array.from({ length: 12 }, (_, n) => `a${n}`).join(' ')}; do for j in ${Array.from({ length: 12 }, (_, n) => `b${n}`).join(' ')}; do echo x > $i$j; done; done`,
    ],
    [
      'a loop over more values than the guard follows',
      `for f in ${Array.from({ length: 20 }, (_, i) => `a${i}`).join(' ')}; do echo x > $f; done`,
    ],
    ['inside a command substitution', 'f=ok; echo x > $(echo $f)'],
    ['never set', 'echo x > $f'],
  ])('%s: still asks that the target cannot be worked out', (_name, command) => {
    expect(bash({ command }).join(' ')).toContain('an expansion this check cannot work out');
  });
});

describe('OutsideGuard.inspect says which hits it could not read', () => {
  const SCRATCHPAD =
    '/tmp/claude-1000/-home-user-project/0b1c2d3e-aaaa-bbbb-cccc-1234567890ab/scratchpad';
  const hitsOf = (opts: { command: string }) =>
    OutsideGuard.inspect({
      input: { tool: 'Bash', filePath: undefined, command: opts.command, cwd: PROJECT },
      projectRoot: PROJECT,
      home: HOME,
      env: ENV,
    });

  test.each([
    ['a program named by a variable', '$tool run'],
    ['a quote that never closes', 'echo "unclosed'],
    ['a redirect to an expansion', 'echo x > $f'],
    ['a path under /proc', 'echo x > /proc/self/fd/1'],
    ['a path through more links than the system follows', 'echo x > spin1/y'],
  ])('%s is unread: the hook asks even where the project denies', (_, command) => {
    const hits = hitsOf({ command });

    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => hit.isUnread)).toBe(true);
  });

  test.each(['echo x > /var/tmp/guard-probe', 'cp a /etc/guard-probe', 'echo x 1<>/etc/zz'])(
    '%s is a path the check read, outside the project: it is not unread',
    (command) => {
      const hits = hitsOf({ command });

      expect(hits.length).toBeGreaterThan(0);
      expect(hits.some((hit) => hit.isUnread)).toBe(false);
    },
  );

  test.each([
    'echo x > /etc/$X',
    'echo x > /etc/${X:-passwd}',
    'echo x > /etc/passwd$X',
    'echo x > "/etc/$X"',
    'echo x 2> /etc/$X',
    'echo k >> /home/u/.ssh/authorized_keys$S',
    'echo x > ~/.ssh/$(echo k)',
    'echo x > ~/"$X"',
    'echo x > ~/$X/../.bashrc',
    'printf x > ~/.config/systemd/user/$N.service',
    'cd ~/.ssh && echo k >> authorized_keys$S',
    'cd /etc && echo x > $f',
    'echo x > /etc/*.conf',
    'echo x > $HOME/.ssh/$X',
    'cd $w && echo x > /etc/$X',
    'bash -c "echo > /etc/$X"',
    'cp a /etc/$X',
    'cp a ~/.config/$N/x',
    'touch /etc/$X',
    'mkdir -p ~/.config/$N',
    'dd of=/etc/$X',
    'echo x | tee ~/.bashrc$X',
  ])(
    '%s lands in a folder outside the project whatever the expansion is: read, so denied',
    (command) => {
      const hits = hitsOf({ command });

      expect(hits.length).toBeGreaterThan(0);
      expect(hits.some((hit) => hit.isUnread)).toBe(false);
    },
  );

  test('an expansion after the scratchpad folder is the scratchpad', () => {
    const hits = hitsOf({ command: `echo x > ${SCRATCHPAD}/$X` });

    expect(hits.map((hit) => hit.isAgentToolScratchpad)).toEqual([true]);
    expect(hits.some((hit) => hit.isUnread)).toBe(false);
  });

  test.each([
    'echo x > $f',
    'echo x > $D/x',
    'cd /etc && echo x > $D/x',
    'cd /etc && echo x > ~$X',
    'cd $w && echo x > ../out-$t.log',
    'cd $w && echo x > $f',
    'cd /etc && cd $w && echo x > out-$t.log',
    'cd /etc && f=$(date) && echo x > $f',
    'cd /etc && for p in a b; do f=/home/u/$(date).txt; echo x > $f; done',
    'echo x > .agents/local/tmp/$t.log',
    'echo x > out-$t.log',
    'cd src && echo x > $f',
  ])('%s has no folder it can read outside the project: unread', (command) => {
    const hits = hitsOf({ command });

    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => hit.isUnread)).toBe(true);
  });

  test.each([
    'touch ~/.bun/install/$X',
    'touch $XDG_RUNTIME_DIR/$X',
    'touch ~/.claude/projects/p/memory/$X',
    'echo x > ~/.bun/install/$X',
  ])('%s is in a folder a tool owns: no hit that is read, whatever the file name is', (command) => {
    expect(hitsOf({ command }).some((hit) => !hit.isUnread)).toBe(false);
  });

  test('a folder a tool owns is not outside: an expansion in it stays unread', () => {
    const hits = OutsideGuard.inspect({
      input: {
        tool: 'Bash',
        filePath: undefined,
        command: `echo x > ${HOME}/owned/$X`,
        cwd: PROJECT,
      },
      projectRoot: PROJECT,
      toolOwnedPaths: [`${HOME}/owned`],
      home: HOME,
      env: ENV,
    });

    expect(hits.every((hit) => hit.isUnread)).toBe(true);
  });

  test('a file tool writing outside the project is read', () => {
    const hits = OutsideGuard.inspect({
      input: { tool: 'Write', filePath: '/var/tmp/guard-probe', command: undefined, cwd: PROJECT },
      projectRoot: PROJECT,
      home: HOME,
      env: ENV,
    });

    expect(hits.map((hit) => hit.isUnread)).toEqual([false]);
  });

  test('a line with a read path outside and an unread part has both, so the read one decides', () => {
    const hits = hitsOf({ command: '$tool run; echo x > /var/tmp/guard-probe' });

    expect(hits.map((hit) => hit.isUnread).sort()).toEqual([false, true]);
  });
});

describe('a write target with a brace list is checked branch by branch', () => {
  const hitsOf = (opts: { command: string }) =>
    OutsideGuard.inspect({
      input: { tool: 'Bash', filePath: undefined, command: opts.command, cwd: PROJECT },
      projectRoot: PROJECT,
      home: HOME,
      env: ENV,
    });

  test.each([
    'touch {/etc,/var}/x',
    'cp a {/etc,/var}/$X',
    'touch {,/etc/}$X',
    'echo x > {out,/etc}/f',
    'echo x | tee {out,/etc}/f',
    'mkdir -p {out,{/etc,/var}}/z',
    'mv a {c,/etc/d}',
    'touch {~,out}/x',
    'touch {a}/{..,y}/..',
    'touch {x/{..,y}/../..',
    'touch {a..bc}/{..,y}/..',
    'touch {a},/etc/x}',
    'git -C {,/etc} clone u d',
    'cp {-t,/etc} a',
    'curl {-o,/etc/a} http://x',
    'dd {of=/etc/x,if=/dev/null}',
    'dd of{,=/etc/x}',
    'export TMPDIR={x,/etc}',
    'export {A,TMPDIR}=/etc/z',
  ])('%s has a branch outside the project: read, so it is a deny', (command) => {
    expect(hitsOf({ command }).map((hit) => hit.isUnread)).toContain(false);
  });

  test.each([
    ['a sequence with an end that is a slash', 'touch {/..0}etc/x'],
    ['thirty lists of two, a billion words', `touch ${'{a,b}'.repeat(30)}`],
    [
      'a list longer than the guard expands',
      `touch ${`{${Array.from({ length: 70 }, (_, i) => `a${i}`).join(',')}}`}/x`,
    ],
  ])('%s cannot be expanded, so it is asked about and never passed', (_, command) => {
    expect(hitsOf({ command }).map((hit) => hit.isUnread)).toEqual([true]);
  });

  test.each([
    'touch out/{a,b}',
    'mkdir -p src/{a,b}/{x,y}',
    'touch file{1..3}.txt',
    'touch {a..c}/x',
    'touch {a}',
    'touch {}',
    'echo x > ${PWD}/out',
    'TMPDIR={/tmp,x} true',
  ])('%s stays inside the project and stays quiet', (command) => {
    expect(hitsOf({ command })).toEqual([]);
  });
});

describe('OutsideGuard.inspect reads the literal assignments of the line before it gives up', () => {
  test.each([
    'S=.agents/local/tmp/x; echo hi > $S/a',
    'S=.agents/local/tmp/x\necho hi > "$S/a"',
    'export X=.agents/local/tmp/y; echo hi > $X/a',
    'export X=.agents/local/tmp/y Y=z; echo hi > $X/$Y',
    'X=.agents/local/tmp/y; export X; echo hi > "$X/a"',
    'S=.agents/local/tmp; T=$S/x; echo hi > $T/a.log',
    'S=a; T=${S}/b; echo hi > $T',
    'for i in 1 2; do echo hi > f$i.log; done',
    'for i in 1 2; do echo hi > $i.log; done',
    'for i in a b; do\n  echo hi > .agents/local/tmp/x/$i.log\ndone',
    'for i in 1 2; do for j in a b; do echo hi > $i$j.log; done; done',
    'for i in 1 2; do echo hi >> out/$i.log 2>&1; done',
    'for i in 1 2; do cp a out/$i.txt; done',
    'for d in a b; do mkdir -p out/$d; touch out/$d/x; done',
  ])('%s is worked out and passes inside the project', (command) => {
    expect(bash({ command })).toEqual([]);
  });

  test.each([
    ['a variable set to a folder outside', 'S=/etc; echo hi > $S/a'],
    ['a variable set to the parent folder', 'S=../..; echo hi > $S/a'],
    ['an exported variable', 'export X=/etc; echo hi > $X/a'],
    ['a variable copied through another', 'S=/etc; T=$S/x; echo hi > $T'],
    ['a loop value outside', 'for i in a /etc; do echo hi > $i/a; done'],
    ['a loop value that climbs out', 'for i in a ../..; do echo hi > $i/a; done'],
    ['a loop value in the middle of a word', 'for i in ok /etc; do echo hi > $i/x.log; done'],
    [
      'two loops, the inner one outside',
      'for i in a; do for j in b /etc; do echo hi > $j/$i; done; done',
    ],
    ['a loop over a folder, a mkdir', 'for d in out /var/tmp/x; do mkdir -p $d; done'],
  ])('%s is worked out and asked about, naming the folder it lands in', (_name, command) => {
    const hits = bash({ command });

    expect(hits.length).toBeGreaterThan(0);
    expect(hits.join(' ')).not.toContain('cannot work out');
  });

  test('a value is not followed into a command line another shell reads', () => {
    expect(bash({ command: "S=/etc; sh -c 'echo hi > $S/a'" }).join(' ')).not.toBe('');
  });
});

describe('OutsideGuard.inspect marks what it could not read', () => {
  test.each([
    'echo hi > $f',
    'echo hi > $(date).log',
    'S=$(pwd); echo hi > $S/a',
    'S=$HOME; echo hi > $S/a',
    'echo hi > ${S:-out}/a',
    'bun run foo > $OUT',
  ])('%s is unread, which the hook denies', (command) => {
    const hits = OutsideGuard.inspect({
      input: { tool: 'Bash', filePath: undefined, command, cwd: PROJECT },
      projectRoot: PROJECT,
      home: HOME,
      env: ENV,
    });

    expect(hits.map((hit) => hit.isUnread)).toContain(true);
  });
});

// A `$` the line quotes or escapes is a character to the shell, and the word's text reads it as a variable: a value built from
// it names a folder the guard does not see. Each of these wrote ../pwn in real bash while the first form of the guard passed it.
describe('OutsideGuard.inspect does not follow a quoted or escaped $, or a variable with an operator', () => {
  const inFolder = join(PROJECT, 'a', 'b');
  const hitsAt = (opts: { command: string }) =>
    OutsideGuard.inspect({
      input: { tool: 'Bash', filePath: undefined, command: opts.command, cwd: inFolder },
      projectRoot: PROJECT,
      home: HOME,
      env: ENV,
    });

  test.each([
    ['a single-quoted $ in an assignment', "S=a/b/c; T='$S'/../..; mkdir -p '$S'; echo x > $T/pwn"],
    ['an escaped $ in an assignment', 'S=a/b/c; T=\\$S/../..; mkdir -p \\$S; echo x > $T/pwn'],
    ['an escaped $ in double quotes in an assignment', 'S=a/b/c; T="\\$S"/../..; echo x > $T/pwn'],
    [
      'a single-quoted $ in an exported assignment',
      "S=a/b/c; export T='$S'/../..; echo x > $T/pwn",
    ],
    ['a single-quoted $ in a loop list', "for i in '$S'/../..; do echo x > $i/pwn; done"],
    [
      'a single-quoted $ in a loop target',
      "for i in a/b/c; do mkdir -p '$i'; echo x > '$i'/../../pwn; done",
    ],
    ['a single-quoted $ in a target', "S=a/b/c; mkdir -p '$S'; echo x > '$S'/../../pwn"],
    ['an escaped $ in a target', 'S=a/b/c; echo x > \\$S/../../pwn'],
    ['an ANSI-C quoted $ in a target', "S=a/b/c; echo x > $'$S'/../../pwn"],
    ['a substitution in a loop value', 'for i in a; do echo x > ${i/a/..}/pwn; done'],
    ['a :+ operator on a loop variable', 'for i in a; do echo x > ${i:+..}/pwn; done'],
    ['a substring of a loop variable', 'for i in a; do echo x > ${i:0:0}../pwn; done'],
    ['a # operator on a loop variable', 'for i in x; do echo x > ${i#x}../pwn; done'],
    ['a substitution in a plain variable', 'S=a; echo x > ${S/a/..}/y'],
    ['a # operator on a plain variable', 'S=x; echo x > ${S#x}../y'],
    ['an indirect expansion', 'i=a; a=..; echo x > ${!i}/y'],
    ['an indirect expansion of a loop variable', 'for i in a; do a=..; echo x > ${!i}/y; done'],
    ['a ^ operator', 'S=a; echo x > ${S^^}/y'],
    ['an @ operator', 'S=a; echo x > ${S@Q}/y'],
    ['a chained value with an operator', 'S=a/b; T=${S%/b}; echo x > $T/../../pwn'],
  ])('%s is not allowed', (_name, command) => {
    expect(hitsAt({ command }).length).toBeGreaterThan(0);
  });

  test.each([
    'S=a/b/c; echo x > ${S}/ok',
    'S=a/b/c; echo x > "$S"/ok',
    'S=a/b/c; echo x > "${S}/ok"',
    "for f in a b; do bun -e 'console.log(`${f}`)' > out/$f.log; done",
    "echo 'costs $5' > notes.txt",
    "S=a/b/c; echo '$HOME' > $S/ok",
  ])('%s still passes: no $ of the target or the assignment is quoted', (command) => {
    expect(hitsAt({ command })).toEqual([]);
  });
});

// A `$` that starts no expansion is a character too, because of what follows it: `"$"S` and `$\S` read as `$S` once the quotes are
// gone, and the shell writes a folder named `$S`. Each of these wrote ../pwn in real bash while the guard passed it.
describe('OutsideGuard.inspect does not follow a $ that starts no expansion', () => {
  const hitsAtRoot = (opts: { command: string }) =>
    OutsideGuard.inspect({
      input: { tool: 'Bash', filePath: undefined, command: opts.command, cwd: PROJECT },
      projectRoot: PROJECT,
      home: HOME,
      env: ENV,
    });

  test.each([
    ['a $ before a closing quote, in a target', 'S=a/b/c; mkdir -p "$"S; echo x > "$"S/../../pwn'],
    ['the same with >>', 'S=a/b/c; mkdir -p "$"S; echo x >> "$"S/../../pwn'],
    ['the same with tee -a', 'S=a/b/c; mkdir -p "$"S; echo x | tee -a "$"S/../../pwn'],
    ['the same with cat >', 'S=a/b/c; mkdir -p "$"S; cat > "$"S/../../pwn'],
    ['a quoted tail', 'S=a/b/c; mkdir -p "$"S; echo x > "$"S"/../../pwn"'],
    ['a $ before a backslash', 'S=a/b/c; mkdir -p "$"S; echo x > $\\S/../../pwn'],
    [
      'a $ before a closing quote, in an assignment',
      'S=a/b/c; mkdir -p "$"S; T="$"S/../..; echo x > $T/pwn',
    ],
    [
      'a $ before a closing quote, on a loop variable',
      'for i in a/b/c; do mkdir -p "$"i; echo x > "$"i/../../pwn; done',
    ],
    [
      'a $ before a closing quote, then braces',
      'S=a/b/c; mkdir -p "$"{S}; echo x > "$"{S}/../../pwn',
    ],
    ['a $ at the end of a word', 'S=a/b; echo x > c$/../../pwn'],
  ])('%s is not allowed', (_name, command) => {
    expect(hitsAtRoot({ command }).length).toBeGreaterThan(0);
  });

  test.each([
    "S=a/b/c; echo x > 'a'$S",
    'S=a/b/c; echo x > "$S"/ok',
    'S=a/b/c; echo x > "$S"\'/ok\'',
    'S=a/b/c; echo x > $"$S"/ok',
    'S=a/b/c; echo x > $((1+1))/ok',
    'echo x > $$.tmp',
  ])('%s keeps passing or asking as before: the $ starts an expansion', (command) => {
    expect(
      hitsAtRoot({ command }).filter((hit) => hit.message.includes('quoted or escaped')),
    ).toEqual([]);
  });
});

// After a `cd` the guard cannot work out, the folder it writes in is only the last one it knew, so a relative path cannot be placed.
describe('OutsideGuard.inspect denies a relative path after a cd it cannot work out', () => {
  const hitsAtRoot = (opts: { command: string }) =>
    OutsideGuard.inspect({
      input: { tool: 'Bash', filePath: undefined, command: opts.command, cwd: PROJECT },
      projectRoot: PROJECT,
      home: HOME,
      env: ENV,
    });

  test.each([
    'cd $UNSET_X; echo x > pwn',
    'X=$(echo ..); cd $X; echo x > pwn',
    'cd "$(echo ..)"; echo x > pwn',
    'cd `echo ..`; echo x > pwn',
    'mkdir -p d; cd d && cd $(echo ../..) && echo x > pwn',
    'for d in a b; do cd $d; echo x > pwn; done',
    'cd - ; echo x > pwn',
    'echo a | cd ..; echo x > pwn',
  ])('%s is not allowed', (command) => {
    expect(hitsAtRoot({ command }).length).toBeGreaterThan(0);
  });

  test.each([
    'CDPATH=.. cd x; echo x > pwn',
    'CDPATH=..; cd x; echo x > pwn',
    'export CDPATH=..; cd x; echo x > pwn',
    'CDPATH=..: cd x; echo x > pwn',
    'CDPATH=.. pushd x; echo x > pwn',
    'declare -x CDPATH=..; cd a/b; echo x > pwn',
  ])('%s is not allowed: CDPATH may put the name in another folder', (command) => {
    expect(hitsAtRoot({ command }).length).toBeGreaterThan(0);
  });

  test('a CDPATH in the environment of the hook does the same, and a name that starts with ./ or ../ does not', () => {
    const inEnv = (command: string) =>
      OutsideGuard.inspect({
        input: { tool: 'Bash', filePath: undefined, command, cwd: PROJECT },
        projectRoot: PROJECT,
        home: HOME,
        env: { ...ENV, CDPATH: '..' },
      });

    expect(inEnv('cd x; echo x > pwn').length).toBeGreaterThan(0);
    expect(inEnv('cd ./x; echo x > pwn')).toEqual([]);
    expect(inEnv('cd ..; echo x > pwn').length).toBeGreaterThan(0);
    expect(inEnv(`cd ${join(PROJECT, 'x')}; echo x > pwn`)).toEqual([]);
    expect(hitsAtRoot({ command: 'CDPATH=..; cd ./x; echo x > pwn' })).toEqual([]);
  });

  test('a cd to a variable the line set is worked out, and its folder is judged', () => {
    expect(hitsAtRoot({ command: 'X=..; cd $X; echo x > pwn' }).map((hit) => hit.isUnread)).toEqual(
      [false],
    );
    expect(hitsAtRoot({ command: 'X=sub; cd $X; echo x > pwn' })).toEqual([]);
  });

  test.each([
    'cd sub && echo x > ok',
    'mkdir -p sub; cd sub; echo x > ok',
    `cd $UNSET_X; echo x > ${join(PROJECT, 'ok')}`,
  ])('%s still passes: the folder is known, or the path is absolute and inside', (command) => {
    expect(hitsAtRoot({ command })).toEqual([]);
  });
});

// A link is a name inside the project for a file outside it: a write through the name changes the file. The guard reads the folder
// tree as it is when the line starts, so a link made earlier on the same line is not there to be followed. A hard link cannot be seen
// on a later call at all, so the file it points at is judged. A symbolic link can: once it exists, a path through it is followed, so on
// the line only a path at or through its name is not followed. Each of the first forms wrote outside the project in real bash while
// the guard passed it (#989).
describe('OutsideGuard.inspect and the links a line makes', () => {
  const hitsAtRoot = (opts: { command: string }) =>
    OutsideGuard.inspect({
      input: { tool: 'Bash', filePath: undefined, command: opts.command, cwd: PROJECT },
      projectRoot: PROJECT,
      home: HOME,
      env: ENV,
    });

  test.each([
    ['a hard link to a file outside, then a write', 'ln ../victim h; echo pwned > h'],
    ['a hard link with -t', 'mkdir -p d; ln -t d ../victim'],
    [
      'a hard link with -t and the folder attached',
      'mkdir -p sub; ln -tsub ../victim; echo x > sub/victim',
    ],
    ['cp -l', 'cp -l ../victim h; echo pwned > h'],
    ['cp --link by a prefix', 'cp --li ../victim h; echo pwned > h'],
    [
      'a hard link to a link of the line, climbing out',
      'ln -s . a; ln a/../victim h; echo pwn > h',
    ],
    ['a hard link through a link of the line, into it', 'ln -s . a; ln ../victim a/h'],
    [
      'a hard link to a relative link copied by ln',
      'mkdir -p x/y; ln -s .. x/y/up; ln x/y/up h; echo x > h/victim',
    ],
  ])('%s is not allowed: the file a hard link points at is judged', (_name, command) => {
    expect(hitsAtRoot({ command }).length).toBeGreaterThan(0);
  });

  test.each([
    ['a symbolic link, then a write at it', 'ln -s ../victim s; echo pwned > s'],
    ['a cd into a link', 'ln -s .. lnk; cd lnk; echo x > pwn'],
    ['a cd through a link made in a folder', 'mkdir -p d; ln -s ../.. d/up; cd d/up; echo x > pwn'],
    ['a write through a link made after a cd', 'mkdir -p d; cd d; ln -s ../.. up; echo x > up/pwn'],
    ['a link whose source climbs out of a link', 'ln -s . a; ln -s a/../victim s; echo pwn > s'],
    [
      'a link made with -t, then a write at it',
      'ln -s . a; ln -s a/../victim -t .; echo x > victim',
    ],
    ['a link made in a subshell', '(ln -s . a); ln -s a/../victim s; echo x > s'],
    ['a suffix option read as -r', 'mkdir -p d; cd d; ln -sSr ../victim ../s; echo x > ../s'],
    ['cp -s', 'cp -s ../victim h; echo pwned > h'],
    ['cp -as', 'cp -as ../victim h; echo pwned > h'],
    ['cp --symbolic-link', 'cp --symbolic-link ../victim h; echo pwned > h'],
    ['cp --sym by a prefix', 'cp --sym ../victim h; echo pwned > h'],
    ['ln --sym by a prefix', 'ln --sym . a; echo x > a/../victim'],
    ['ln --sym by a prefix, in a folder', 'mkdir d; cd d; ln --sym ../victim ../s; echo x > ../s'],
    ['ln -s with --rel by a prefix', 'ln -s --rel ../victim d/e/l; echo x > d/e/l'],
    ['a link name made by a loop', 'for n in a; do ln -s . $n; done; echo x > a/../victim'],
    ['a link made in another shell', "bash -c 'ln -s . a'; echo x > a/../victim"],
    ['a link made through xargs', 'echo a | xargs ln -s .; echo x > a/../victim'],
    ['git -C through a link', 'ln -s . a; git -C a/.. init -q'],
    ['a move of a link of the line', 'mkdir -p x; ln -s ../victim x/l; mv x/l .; echo x > l'],
    [
      'a move of a link, then a write through the new name',
      'mkdir -p x/y; ln -s .. x/y/up; mv x/y/up h; echo x > h/victim',
    ],
    ['a cp -P of a link', 'mkdir -p x/y; ln -s .. x/y/up; cp -P x/y/up h; echo x > h/victim'],
    ['a cp -a of a link', 'mkdir -p x/y; ln -s .. x/y/up; cp -a x/y/up h; echo x > h/victim'],
    [
      'an rsync -l of a link',
      'mkdir -p x/y; ln -s .. x/y/up; rsync -l x/y/up h; echo x > h/victim',
    ],
    ['a mv -t of a link', 'mkdir -p x/y; ln -s .. x/y/up; mv -t . x/y/up; echo x > up/victim'],
    ['a write through a link of the line', 'mkdir -p sub; ln -s sub lnk; echo x > lnk/pwn'],
    ['a cd into a link of the line', 'mkdir -p sub; ln -s sub lnk; cd lnk; echo x > ok'],
  ])('%s is not followed, so it is not allowed', (_name, command) => {
    expect(hitsAtRoot({ command }).length).toBeGreaterThan(0);
  });

  test('a hard link to a path outside is marked, so the hook denies it and says how to link inside', () => {
    const hits = hitsAtRoot({ command: 'ln ../victim h' });

    expect(hits.some((hit) => hit.isLink === true && !hit.isUnread)).toBe(true);
  });

  test.each([
    'ln -s /usr/bin/env x',
    'ln -s ~/.cache x',
    'ln -s $(pwd)/pkg pl',
    'ln -s node_modules/.bin/vulcan v',
    'mkdir -p sub; cd sub; ln -s ../node_modules nm',
    'ln -sf a b; ln -sf c b',
    'ln -s a b; echo hi > c',
    'ln -s a b c d',
    'ln pkg/a.txt h',
    'cp -s a b',
    'cp -r a b; echo x > c',
    'mv a b',
    'ln -sf .agents/local/tmp/x fresh-name; echo y > .agents/local/tmp/z',
  ])(
    '%s passes: a symbolic link is read once it exists, and nothing goes through the new name',
    (command) => {
      expect(hitsAtRoot({ command })).toEqual([]);
    },
  );
});
