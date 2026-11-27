import { afterAll, describe, expect, test } from 'bun:test';
import { OutsideGuard, RunnerGuard } from '../../hooks/index.ts';
import { ShellParser } from '../../hooks/shell.ts';
import { ShellPrograms } from '../../hooks/shell-programs.ts';
import { createProject, removeProjects } from '../helpers/project.helper.ts';

afterAll(removeProjects);

const refused = (command: string): boolean =>
  RunnerGuard.inspect({ command, cwd: '/tmp', allow: [] }).length > 0;

describe('a runner behind a launcher is found', () => {
  test.each([
    'taskset -c 0 bunx ardor',
    'taskset -c 0-3 bunx ardor',
    'taskset 0x1 bunx ardor',
    'taskset --cpu-list 0 bunx ardor',
    'chrt -f 10 bunx ardor',
    'chrt --rr 5 npx ardor',
    'chrt --fifo 1 flock lock bunx ardor',
    'flock lock bunx ardor',
    'flock -n lock bunx ardor',
    'flock -w 5 lock bunx ardor',
    "flock lock -c 'bunx ardor'",
    "flock -n lock -c 'bunx ardor'",
    'flock --timeout 5 lock npx ardor',
    'runuser -u u -- bunx ardor',
    'runuser -u u bunx ardor',
    "runuser u -c 'bunx ardor'",
    "runuser -l u -c 'bunx ardor'",
    'parallel bunx ardor ::: a b',
    'parallel -j4 bunx ardor ::: a',
    'parallel --jobs 2 npx ardor ::: a',
    "parallel 'bunx ardor {}' ::: a",
    "script -qec 'bunx ardor' /dev/null",
    "script -c 'bunx ardor' /dev/null",
    "su -c 'bunx ardor' user",
    "su user -c 'bunx ardor'",
    "su -lc 'bunx ardor' user",
    "sudo su -c 'bunx ardor'",
    "find . -exec sh -c 'bunx ardor' ;",
    "find . -exec bash -c 'cd x && bunx ardor {}' ;",
    "find . -execdir sh -c 'npx ardor' ;",
    'find . -exec bunx ardor {} ;',
    "xargs sh -c 'bunx ardor'",
    "taskset -c 0 flock lock su -c 'bunx ardor'",
  ])('%s is refused', (command) => {
    expect(refused(command)).toBe(true);
  });

  test.each([
    'taskset -c 0 make test',
    'chrt -f 10 make test',
    'taskset 0x1 bun run test',
    'flock lock make test',
    "flock lock -c 'make test'",
    'runuser -u u -- make test',
    "runuser u -c 'ls'",
    'parallel echo ::: a b',
    "parallel 'echo {}' ::: a",
    "script -qec 'make test' /dev/null",
    "su -c 'ls' user",
    "find . -exec sh -c 'echo {}' ;",
    'bunx @venizia/vulcan --version',
    'echo su -c foo',
  ])('%s passes', (command) => {
    expect(refused(command)).toBe(false);
  });
});

describe('create, init and a global add fetch a package by name', () => {
  test.each([
    'bun create vite myapp',
    'bun create vite@latest',
    'bun create next-app',
    'bun create github-user/repo',
    'npm init vite',
    'npm init vite@latest',
    'npm init -y vite',
    'npm create vite',
    'npm create vite@latest myapp',
    'pnpm create vite',
    'yarn create vite',
    'npm init @scope',
    'npm create @scope',
    'bun create @scope',
    'bun add -g vulcan',
    'bun add --global vulcan',
    'bun add vulcan -g',
    'bun add -g --silent vulcan',
    'bunx --bun create-vite',
    'taskset -c 0 bun create vite',
    "su -c 'npm init vite' user",
    'cd x && bun create vite',
  ])('%s is refused', (command) => {
    expect(refused(command)).toBe(true);
  });

  test.each([
    'bun create',
    'bun create @scope/template app',
    'npm init',
    'npm init -y',
    'npm init @scope/pkg',
    'npm create @scope/pkg',
    'pnpm create @scope/pkg',
    'bun add typescript',
    'bun add -d typescript',
    'bun add -g @scope/pkg',
    'bun add',
    'bun install',
    'bun run build',
    'npm install',
    'npm install -g @scope/pkg',
  ])('%s passes: no name, a scoped name, or not global', (command) => {
    expect(refused(command)).toBe(false);
  });

  test('the answer says what to do instead, and does not name a bin that does not exist', () => {
    const [hit] = RunnerGuard.inspect({ command: 'bun create vite', cwd: '/tmp', allow: [] });

    expect(hit?.message).toContain('guard.runners.allow');
    expect(hit?.fix).toContain('dependencies');
  });

  test('guard.runners.allow lets the name through', () => {
    expect(
      RunnerGuard.inspect({ command: 'bun create vite', cwd: '/tmp', allow: ['vite'] }),
    ).toEqual([]);
  });
});

describe('ShellPrograms.programOf reads past the launchers', () => {
  const programOf = (line: string): string => {
    const [command] = ShellParser.parseChecked({ command: line }).commands;

    return command === undefined ? '' : ShellPrograms.programOf({ command }).name;
  };

  test.each([
    ['taskset -c 0 make', 'make'],
    ['taskset 0x3 make', 'make'],
    ['flock lock make', 'make'],
    ['flock -n -w 3 lock make', 'make'],
    ['runuser -u user -- make', 'make'],
    ['runuser -u user make', 'make'],
    ['parallel -j4 make ::: a', 'make'],
    ['parallel -k make ::: a', 'make'],
    ['sudo taskset -c 0 flock lock make', 'make'],
  ])('%s runs %s', (line, program) => {
    expect(programOf(line)).toBe(program);
  });
});

describe('what a launcher runs is judged by the write guard', () => {
  const root = createProject({ files: { 'package.json': '{}', 'src/a.ts': 'x' } });
  const hits = (command: string) =>
    OutsideGuard.inspect({
      input: { tool: 'Bash', command, cwd: root, filePath: undefined },
      projectRoot: root,
      env: { HOME: '/nonexistent-home' },
    });

  test.each([
    "su -c 'echo x > /tmp/vulcan-probe-y' user",
    "su user -c 'echo x > /tmp/vulcan-probe-y'",
    "script -qec 'echo x > /tmp/vulcan-probe-y' /dev/null",
    "flock lock -c 'echo x > /tmp/vulcan-probe-y'",
    'flock lock tee /tmp/vulcan-probe-y',
    "runuser -u u -- sh -c 'echo x > /tmp/vulcan-probe-y'",
    'runuser -u u -- tee /tmp/vulcan-probe-y',
    "runuser u -c 'echo x > /tmp/vulcan-probe-y'",
    "taskset -c 0 sh -c 'echo x > /tmp/vulcan-probe-y'",
    'taskset 0x1 tee /tmp/vulcan-probe-y',
    'parallel -j4 tee /tmp/vulcan-probe-y ::: a',
    "parallel 'echo x > /tmp/vulcan-probe-y' ::: a",
    "find . -exec sh -c 'echo x > /tmp/vulcan-probe-y' ;",
    "find . -exec bash -c 'cp {} /tmp/vulcan-probe-y' ;",
    "find . -name '*.ts' -exec sh -c 'tee /tmp/vulcan-probe-y' ;",
  ])('%s is a write outside the project', (command) => {
    expect(hits(command).length).toBeGreaterThan(0);
  });

  test.each([
    "su -c 'echo x > src/y' user",
    "script -qec 'echo x > src/y' /dev/null",
    "flock lock -c 'echo x > src/y'",
    'flock lock tee src/y',
    'taskset -c 0 tee src/y',
    "find . -exec sh -c 'echo x > src/y' ;",
    "find . -exec sh -c 'cp {} src/' ;",
  ])('%s passes: it writes inside the project', (command) => {
    expect(hits(command)).toEqual([]);
  });

  test.each([
    "su -c 'echo x > .claude/settings.json'",
    "script -qec 'cp y .claude/settings.json' /dev/null",
    "flock lock -c 'rm -rf .claude/*'",
    "runuser u -c 'echo x > .agents/hooks.json'",
    "find . -exec sh -c 'echo x > .claude/settings.json' ;",
    "find . -exec sh -c 'cp {} .claude/settings.json' ;",
    "taskset -c 0 sh -c 'sed -i s/a/b/ .claude/settings.json'",
  ])('%s is denied: it writes a file the guards read', (command) => {
    expect(hits(command).some((hit) => hit.isProtected === true)).toBe(true);
  });
});
