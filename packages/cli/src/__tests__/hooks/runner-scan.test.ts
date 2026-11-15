import { describe, expect, test } from 'bun:test';
import { RunnerScan } from '../../hooks/runner-scan.ts';

/** The names the scan would refuse in `text`, `allow` being the names a project permits. */
const refused = (opts: { text: string; allow?: string[] }): string[] =>
  RunnerScan.find({ text: opts.text })
    .map((use) => RunnerScan.refusedName({ use, allow: opts.allow ?? [] }))
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
    ['an @veniziax scope', 'bunx @veniziax/foo', '@veniziax/foo'],
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
    ['a scoped @venizia package', 'bun x @venizia/vulcan init'],
    ['a scoped package with a version', 'bun x @venizia/vulcan@0.4.10 init'],
    ['a scoped package with the latest tag', 'bun x @venizia/vulcan@latest init'],
    ['--package of a scoped package, then its bin', 'bun x --package @venizia/ardor ardor codemod'],
    ['-p of a scoped package', 'bun x -p @venizia/ardor ardor'],
    ['no name at all', 'bunx'],
  ])('%s', (_label, text) => {
    expect(refused({ text })).toEqual([]);
  });

  test('a name on the allow-list, with or without a version', () => {
    expect(refused({ text: 'bunx shadcn@latest add button', allow: ['shadcn'] })).toEqual([]);
    expect(refused({ text: 'bunx shadcn@2.1.0 add', allow: ['shadcn'] })).toEqual([]);
    expect(refused({ text: 'bunx shadcn add', allow: [] })).toEqual(['shadcn']);
    expect(refused({ text: 'bunx shadcnx add', allow: ['shadcn'] })).toEqual(['shadcnx']);
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
  ])('%s', (_label, text) => {
    expect(refused({ text })).toEqual([]);
  });
});

describe('RunnerScan: --no-install', () => {
  test('is seen only when it is the exact flag before the name', () => {
    const noInstall = (text: string): boolean | undefined =>
      RunnerScan.find({ text })[0]?.hasNoInstall;

    expect(noInstall('bun x --no-install vulcan sync')).toBe(true);
    expect(noInstall('bun x --bun --no-install vulcan sync')).toBe(true);
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
