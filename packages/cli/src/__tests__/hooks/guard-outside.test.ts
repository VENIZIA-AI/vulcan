import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, symlinkSync } from 'node:fs';
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
    ['copied through another variable', 'f=ok; g=$f; echo x > $g'],
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
