import { describe, expect, test } from 'bun:test';
import { RunnerScan } from '../../hooks/runner-scan.ts';

/** The names the scan would refuse in `text`, `allow` being the names a project permits. */
const refused = (opts: { text: string; allow?: string[] }): string[] =>
  RunnerScan.find({ text: opts.text })
    .map((use) => RunnerScan.refusedName({ use, allow: opts.allow ?? [], isFile: true }))
    .filter((name): name is string => name !== undefined);

describe('RunnerScan: a command that runs an unscoped package', () => {
  test.each([
    ['bunx', 'bunx ardor codemod', 'ardor'],
    ['bun x', 'bun x ardor', 'ardor'],
    ['npx', 'npx ardor codemod', 'ardor'],
    ['npm exec', 'npm exec ardor', 'ardor'],
    ['npm x', 'npm x ardor', 'ardor'],
    ['pnpm dlx', 'pnpm dlx ardor', 'ardor'],
    ['yarn dlx', 'yarn dlx ardor', 'ardor'],
    ['a flag of bun', 'bun x --bun ardor', 'ardor'],
    ['bun with its flag first', 'bun --bun x ardor', 'ardor'],
    ['a silent flag', 'bun x --silent ardor', 'ardor'],
    ['an environment prefix', 'FOO=1 bun x ardor', 'ardor'],
    ['tabs', 'bun\tx\tardor', 'ardor'],
    ['a flag with a value, unscoped package', 'bun x -p foo ardor', 'foo'],
    ['--package with an unscoped package', 'bun x --package foo ardor', 'foo'],
    ['--cwd then the name', 'bun x --cwd ./apps/web ardor', 'ardor'],
    ['--env-file then the name', 'bun x --env-file .env ardor', 'ardor'],
    ['--registry then the name', 'bunx --registry https://r.example.test ardor', 'ardor'],
    ['--no-install, which does not make a name safe', 'bun x --no-install ardor', 'ardor'],
    ['--no-install=false', 'bun x --no-install=false ardor', 'ardor'],
    ['--no-install-foo', 'bun x --no-install-foo ardor', 'ardor'],
    ['--no-install after the name', 'bun x ardor --no-install', 'ardor'],
    ['a quoted flag', 'bun x "--bun" ardor', 'ardor'],
    ['a single-quoted name', "bunx 'ardor'", 'ardor'],
    ['a name in backticks', 'bunx `ardor`', 'ardor'],
    ['inline code in prose', 'run `bunx ardor codemod`', 'ardor'],
    ['a fenced block', '```sh\nbunx ardor\n```', 'ardor'],
    ['a line continuation', 'bunx \\\n  ardor codemod', 'ardor'],
    ['a continuation after a flag', 'bun x --bun \\\n  ardor', 'ardor'],
    ['an array form', "['bun', 'x', 'ardor']", 'ardor'],
    ['a JSON script', '"lint": "bunx ardor lint"', 'ardor'],
    ['a table cell', '| bunx ardor | codemod |', 'ardor'],
    ['a YAML run step', 'run: bunx ardor codemod', 'ardor'],
    ['a YAML list item', '- bunx ardor', 'ardor'],
    ['a chained command', 'cd app && bunx ardor', 'ardor'],
    ['a Dockerfile line', 'RUN bunx ardor build', 'ardor'],
    ['a prompt', '$ bunx ardor', 'ardor'],
    ['a Makefile recipe', '\t@bunx ardor', 'ardor'],
    ['a name with a version', 'bunx ardor@latest', 'ardor@latest'],
    ['pnpx', 'pnpx ardor', 'ardor'],
    ['a global flag of npm before exec', 'npm --yes exec ardor', 'ardor'],
    ['a global flag with =', 'npm --loglevel=silent exec ardor', 'ardor'],
    ['a global flag with a value', 'npm --loglevel silent exec ardor', 'ardor'],
    ['a global flag of pnpm', 'pnpm --silent dlx ardor', 'ardor'],
    ['a global flag of yarn', 'yarn --silent dlx ardor', 'ardor'],
    ['corepack in front', 'corepack pnpm dlx ardor', 'ardor'],
    ['a flag of bun before x, with a value', 'bun --cwd other x ardor', 'ardor'],
    [
      'a flag this table does not know, then a scoped decoy',
      'bunx --ca @venizia/vulcan ardor',
      'ardor',
    ],
    ['--cafile', 'bunx --cafile ca.pem ardor', 'ardor'],
    ['--cache of npx', 'npx --cache ./c ardor', 'ardor'],
    ['--workspace of npx', 'npx -w web ardor', 'ardor'],
    ['--loglevel with a space', 'npm exec --loglevel info ardor', 'ardor'],
    ['--reporter of pnpm', 'pnpm dlx --reporter silent ardor', 'ardor'],
    ['a flag first and the name last, unknown', 'bunx --some-switch ardor', 'ardor'],
    ['an array form with a flag', "['bunx', '--yes', 'ardor']", 'ardor'],
    ['an array form of bun x with flags', "['bun', 'x', '--no-install', 'ardor']", 'ardor'],
    [
      'a foreach that spells the runner after a comma',
      '$(foreach p,$(PKGS),bun x --no-install devz check &&) true',
      'devz',
    ],
    [
      'a runner whose name wraps to the next line of a Markdown paragraph',
      '(`bun x --no-install\nvulcan atlas mcp`)',
      'vulcan',
    ],
    ['an allow-listed name with a foreign spec', 'bunx shadcn@npm:ardor add', 'shadcn@npm:ardor'],
    [
      'a scoped name pinned by a bare variable, which may hold an npm: spec',
      'bunx @venizia/vulcan@$X init',
      '@venizia/vulcan@$X',
    ],
    ['a command string with a package', "npx -p foo -c 'echo hi'", 'foo'],
    ['a runner inside the command string of npx', "npx -c 'bunx ardor'", 'ardor'],
    [
      '--shell-mode is a switch of pnpm dlx, the first word is fetched',
      'pnpm dlx --shell-mode ardor',
      'ardor',
    ],
    ['-c is a switch of pnpm dlx', "pnpm dlx -c 'ardor hi'", 'ardor'],
    ['bunx, where -c is a config file', 'bunx -c bunfig.toml ardor', 'ardor'],
    ['a bare @venizia', 'bunx @venizia', '@venizia'],
  ])('%s', (_label, text, name) => {
    expect(refused({ text })).toEqual([name]);
  });

  test('the line of the command is the line it starts on', () => {
    const [use] = RunnerScan.find({ text: 'one\ntwo\nbunx \\\n  ardor\n' });

    expect(use.line).toBe(3);
  });
});

describe('RunnerScan: what is allowed', () => {
  test.each([
    ['a scoped @venizia package', 'bun x @venizia/vulcan project init'],
    ['a scoped package with a version', 'bun x @venizia/vulcan@0.4.10 init'],
    ['a scoped package with the latest tag', 'bun x @venizia/vulcan@latest init'],
    ['a scope that is not venizia', 'bunx @veniziax/foo'],
    ['any scoped package', 'npx @acme/tool run'],
    [
      'a scoped package pinned by a command substitution',
      'bun x @venizia/vulcan@$(cat VERSION) init',
    ],
    ['a scoped package pinned by a variable', 'bunx @venizia/vulcan@${VULCAN_VERSION} init'],
    ['npx with a command string', "npx -c 'echo hi'"],
    ['npm exec with a command string', "npm exec --call 'echo hi'"],
    ['--package of a scoped package, then its bin', 'bun x --package @venizia/ardor ardor codemod'],
    ['-p of a scoped package', 'bun x -p @venizia/ardor ardor'],
    ['no name at all', 'bunx'],
    ['no name behind a switch', 'bunx --bun'],
  ])('%s', (_label, text) => {
    expect(refused({ text })).toEqual([]);
  });

  test('a name on the allow-list, with or without a version', () => {
    expect(refused({ text: 'bunx shadcn@latest add button', allow: ['shadcn'] })).toEqual([]);
    expect(refused({ text: 'bunx shadcn@2.1.0 add', allow: ['shadcn'] })).toEqual([]);
    expect(refused({ text: 'bunx shadcn add', allow: [] })).toEqual(['shadcn']);
    expect(refused({ text: 'bunx shadcnx add', allow: ['shadcn'] })).toEqual(['shadcnx']);
  });

  test('a name on the allow-list does not take another package as its version', () => {
    expect(refused({ text: 'bunx shadcn@npm:ardor add', allow: ['shadcn'] })).toEqual([
      'shadcn@npm:ardor',
    ]);
    expect(refused({ text: 'bunx shadcn@github:a/b add', allow: ['shadcn'] })).toEqual([
      'shadcn@github:a/b',
    ]);
    expect(refused({ text: 'bunx shadcn@^2.1.0 add', allow: ['shadcn'] })).toEqual([]);
  });
});

describe('RunnerScan: prose is not a command', () => {
  test.each([
    ['a sentence about bunx', 'use bunx to run'],
    ['bunx in backticks, no command after', 'never `bunx` with the bare name'],
    ['bunx as part of a word', 'mybunx ardor'],
    ['an extension', 'bunx.cmd ardor'],
    ['a file called x', 'bun x.ts'],
    ['bun run of a script named x', 'bun run x ardor'],
    ['a sentence that names npx', 'The npx tool downloads packages.'],
    ['an install command', 'bun add -d ardor'],
    [
      'runners listed in a sentence',
      'no bunx, pnpm dlx or yarn dlx of a name, nor bun x, npx or npm exec',
    ],
    [
      'bun x as code in a sentence',
      'the flag `bun x` fetches it when the package is not installed',
    ],
    [
      'a program followed by the name of an object method',
      'bun constructor and npm toString, then yarn hasOwnProperty',
    ],
    ['a runner and its subcommand in separate sentences', 'We tried bun. x is a script of ours'],
  ])('%s', (_label, text) => {
    expect(refused({ text })).toEqual([]);
  });
});

describe('RunnerScan: --no-install', () => {
  test('is seen only when it is the exact flag before the name', () => {
    const noInstall = (text: string): boolean | undefined =>
      RunnerScan.find({ text })[0]?.hasNoInstall;

    expect(noInstall('bun x --no-install vulcan project sync')).toBe(true);
    expect(noInstall('bun x --bun --no-install vulcan project sync')).toBe(true);
    expect(noInstall('bun x --no-install=false vulcan')).toBe(false);
    expect(noInstall('bun x --no-install-foo vulcan')).toBe(false);
    expect(noInstall('bun x vulcan --no-install')).toBe(false);
    expect(noInstall('bun x vulcan')).toBe(false);
  });
});

describe('RunnerScan: a placeholder version in a scoped name', () => {
  test('@venizia/vulcan@<version> is a scoped package, not an unscoped name', () => {
    expect(refused({ text: 'bun x @venizia/vulcan@<version> init' })).toEqual([]);
  });
});

describe('RunnerScan: an example marked in Markdown', () => {
  const marked = '<!-- runners: example -->\n```sh\nbunx ardor\n```\n\nbunx devz\n';

  test('the marker sets apart the fenced block after it, and only that', () => {
    const uses = RunnerScan.find({ text: marked, isMarkdown: true });

    expect(uses.map((use) => [use.name, use.isExample])).toEqual([
      ['ardor', true],
      ['devz', false],
    ]);
  });

  test('it sets apart a single line, too', () => {
    const uses = RunnerScan.find({
      text: '<!-- runners: example -->\nbunx ardor\nbunx devz\n',
      isMarkdown: true,
    });

    expect(uses.map((use) => use.isExample)).toEqual([true, false]);
  });

  test('a marker before a fence that never closes sets nothing apart', () => {
    const uses = RunnerScan.find({
      text: '<!-- runners: example -->\n```sh\nbunx ardor\n\nbunx devz\n',
      isMarkdown: true,
    });

    expect(uses.map((use) => use.isExample)).toEqual([false, false]);
  });

  test('a file that is not Markdown has no marker', () => {
    expect(RunnerScan.find({ text: marked }).map((use) => use.isExample)).toEqual([false, false]);
  });
});
