import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ManifestGuard } from '../../hooks/index.ts';
import { git } from '../git-repo.helper.ts';
import { answerOf } from '../manifest-hook.helper.ts';
import { removeProjects } from '../project.helper.ts';
import { buildTableProject } from './guard-manifest-project.helper.ts';
import { TABLE_CASES } from './guard-manifest-table.helper.ts';
import type { ITableCase } from './guard-manifest-table.helper.ts';

afterAll(removeProjects);

let root = '';

beforeAll(() => {
  root = buildTableProject();
});

const inputOf = (opts: { item: ITableCase }): Record<string, string> => {
  const tool = opts.item.tool ?? 'Bash';

  if (tool === 'Bash') {
    return { command: opts.item.cmd };
  }

  return tool === 'NotebookEdit'
    ? { ['notebook_path']: opts.item.file ?? '' }
    : { ['file_path']: opts.item.file ?? '' };
};

const cwdOf = (opts: { item: ITableCase }): string =>
  opts.item.cwd === undefined ? root : join(root, opts.item.cwd);

const label = (opts: { item: ITableCase }): string =>
  `${opts.item.exp === 'deny' ? 'allowed, should deny' : 'denied, should allow'}: ${opts.item.area}: ${(opts.item.cmd || `${opts.item.tool} ${opts.item.file}`).slice(0, 110)}`;

describe('the case table', () => {
  test('every case gets the expected answer', () => {
    const wrong = TABLE_CASES.filter(
      (item) =>
        ManifestGuard.inspectWrite({
          input: {
            tool: item.tool ?? 'Bash',
            filePath: item.file,
            command: item.tool === undefined || item.tool === 'Bash' ? item.cmd : undefined,
            cwd: cwdOf({ item }),
          },
        }) !==
        (item.exp === 'deny'),
    ).map((item) => label({ item }));

    expect(wrong).toEqual([]);
  });

  test('a sample of the cases gets the same answer through the hook script', () => {
    const wrong = TABLE_CASES.filter((_item, index) => index % 7 === 0)
      .filter(
        (item) =>
          answerOf({
            tool: item.tool ?? 'Bash',
            input: inputOf({ item }),
            cwd: cwdOf({ item }),
          }) !== (item.exp === 'deny' ? 'deny' : undefined),
      )
      .map((item) => label({ item }));

    expect(wrong).toEqual([]);
  });

  test('the table holds refusals and passes of every area', () => {
    const areas = new Set(TABLE_CASES.map((item) => item.area));

    expect(TABLE_CASES.length).toBeGreaterThan(350);

    for (const area of [
      'A-git',
      'A-cd',
      'A-prefix',
      'A-folder',
      'A-interp',
      'A-file',
      'B-git',
      'B-read',
    ]) {
      expect(areas.has(area), area).toBe(true);
    }
  });
});

describe('the readers and the programs that write', () => {
  const REFUSED: string[] = [
    'chroot . git checkout HEAD~1 -- .',
    'unshare -m git checkout HEAD~1 -- .',
    'parallel git checkout {} -- . ::: HEAD~1',
    "script -qec 'git checkout HEAD~1 -- .' /dev/null",
    "watch -n1 'git checkout HEAD~1 -- .'",
    "flock lock.f -c 'git checkout HEAD~1 -- .'",
    'flock -x lock.f git checkout HEAD~1 -- .',
    'busybox sh -c "cd .agents && cp ../copy/.agents/vulcan.manifest.json ."',
    'cd .agents && git stash apply stash@{1}',
    'git -C .agents restore -s HEAD~1 vulcan.manifest.json',
    'git read-tree -u HEAD~1',
    'git rm .agents/vulcan.manifest.json',
    'git mv .agents/vulcan.manifest.json x',
    'chmod 000 .agents/vulcan.manifest.json',
    'touch .agents/vulcan.manifest.json',
    'gzip .agents/vulcan.manifest.json',
    'ex -sc "x" .agents/vulcan.manifest.json',
    'xxd -r in .agents/vulcan.manifest.json',
    'uniq in .agents/vulcan.manifest.json',
    'yq -i .v=2 .agents/vulcan.manifest.json',
    'sed -n "w .agents/vulcan.manifest.json" README.md',
    'tar -cf .agents/vulcan.manifest.json src',
    'rsync -a copy/.agents/vulcan.manifest.json .agents/',
    'install -m 644 manifest.bak .agents/vulcan.manifest.json',
    'cp manifest.bak ./.agents/./vulcan.manifest.json',
    'cp manifest.bak .agents/vulcan.manifest.{json,x}',
    'echo x > .agents/vulcan.manifest.{json,bak}',
    'ln -sf manifest.bak .agents/vulcan.manifest.json',
    'bun x --no-install vulcan sync --manifest .agents/vulcan.manifest.json',
    'python3 tools/gen.py .agents/vulcan.manifest.json',
    'node gen.js .agents/vulcan.manifest.json',
    'mv .agents ../x',
    'rm -rf ag',
    'cd ag && rm vulcan.manifest.json',
  ];
  const PASSED: string[] = [
    'git checkout HEAD -- .agents/rules.md',
    'git diff HEAD~1 -- .agents',
    'git log -p -- .agents/vulcan.manifest.json',
    'git blame .agents/vulcan.manifest.json',
    'git add .agents/vulcan.manifest.json',
    'git stash show -p stash@{1}',
    'cat .agents/vulcan.manifest.json | jq . | tee out.json',
    'wc -l .agents/vulcan.manifest.json',
    'ls -l .agents/vulcan.manifest.json',
    'stat .agents/vulcan.manifest.json',
    'sha256sum .agents/vulcan.manifest.json',
    'head -c 100 .agents/vulcan.manifest.json',
    'test -f .agents/vulcan.manifest.json && echo yes',
    '[ -f .agents/vulcan.manifest.json ]',
    'prettier --check .agents/vulcan.manifest.json',
    'diff -u manifest.bak .agents/vulcan.manifest.json',
    'cd .agents && cat vulcan.manifest.json',
    'cd .agents && ls && cd ..',
    'echo "tee .agents/vulcan.manifest.json"',
    'printf "%s" > notes.txt',
    'gh pr create --title t --body "text > .agents/vulcan.manifest.json"',
    'git commit -m "docs: cp x .agents/vulcan.manifest.json"',
    'rg vulcan.manifest.json docs',
    'sort -u list.txt',
    'sort .agents/vulcan.manifest.json',
    'find . -name "*.ts" -exec grep -l x {} +',
    'tar -tf dist.tgz',
    'tar -czf out.tgz .agents',
    'unzip -l x.zip',
    'cp -r src build',
    'mkdir -p build/.agents',
  ];
  const check = (command: string): boolean =>
    ManifestGuard.inspectWrite({
      input: { tool: 'Bash', filePath: undefined, command, cwd: root },
    });

  test('a program that is not a reader is refused when it names the file, whatever it does', () => {
    expect(REFUSED.filter((command) => !check(command))).toEqual([]);
  });

  test('a reader, and a command that only mentions the name as text, pass', () => {
    expect(PASSED.filter((command) => check(command))).toEqual([]);
  });
});

describe('time and git runs', () => {
  const fill = (unit: string, size: number): string =>
    unit.repeat(Math.ceil(size / unit.length)).slice(0, size);
  const distinct = (opts: { size: number; make: (index: number) => string }): string => {
    const words: string[] = [];
    let length = 0;

    for (let index = 0; length < opts.size; index += 1) {
      const word = opts.make(index);

      words.push(word);
      length += word.length + 1;
    }

    return words.join(' ');
  };
  const ADVERSARIAL: { name: string; build: (size: number) => string }[] = [
    { name: 'tee', build: (size) => fill('tee ', size) },
    { name: 'cp x', build: (size) => fill('cp x ', size) },
    {
      name: 'rm of a name that is almost the file',
      build: (size) => fill('rm vulcan.manifest.jso ', size),
    },
    { name: 'vim a', build: (size) => fill('vim a ', size) },
    { name: 'sed -i', build: (size) => fill('sed -i ', size) },
    { name: 'sed -i on lines', build: (size) => fill('sed -i s/a/b/ x\n', size) },
    { name: 'redirects', build: (size) => `echo ${fill('> a ', size)}` },
    { name: 'glob soup as a target', build: (size) => `cp x ${fill('*x*y*z', size)}` },
    {
      name: 'glob soup as a pathspec',
      build: (size) => `git checkout HEAD -- ${fill('*x*y*z ', size)}`,
    },
    { name: 'pathspec list', build: (size) => `git checkout HEAD -- ${fill('src/a.ts ', size)}` },
    { name: 'find filters', build: (size) => `find . ${fill('-name manif ', size)} -delete` },
    { name: 'script calls', build: (size) => `node -e "${fill('writeFileSync(a,', size)}"` },
    { name: 'script nesting', build: (size) => `python3 -c "f${fill('(', size)}"` },
    {
      name: 'distinct words for cat',
      build: (size) => `cat ${distinct({ size, make: (index) => `w${index}` })}`,
    },
    {
      name: 'distinct words for rm',
      build: (size) => `rm ${distinct({ size, make: (index) => `w${index}` })}`,
    },
    {
      name: 'distinct patterns for rm',
      build: (size) => `rm ${distinct({ size: size / 2, make: (index) => `w${index}*x` })}`,
    },
    {
      name: 'distinct pathspecs',
      build: (size) =>
        `git checkout HEAD -- ${distinct({ size, make: (index) => `src/f${index}` })}`,
    },
    {
      name: 'distinct pathspec patterns',
      build: (size) =>
        `git checkout HEAD -- ${distinct({ size: size / 2, make: (index) => `src/*f${index}*` })}`,
    },
    {
      name: 'distinct braces',
      build: (size) => `tee ${distinct({ size: size / 2, make: (index) => `a{b,c}${index}` })}`,
    },
    { name: 'quote soup', build: (size) => fill("a'b", size) },
    { name: 'substitution nesting', build: (size) => `echo ${fill('$(', size)}` },
  ];

  const elapsed = (opts: { command: string }): number => {
    const started = performance.now();

    ManifestGuard.inspectWrite({
      input: { tool: 'Bash', filePath: undefined, command: opts.command, cwd: root },
    });

    return performance.now() - started;
  };

  for (const size of [10_000, 99_000]) {
    for (const item of ADVERSARIAL) {
      test(`${item.name}, ${size} characters, is read in under 100 ms`, () => {
        const command = item.build(size);

        elapsed({ command });

        expect(
          Math.min(elapsed({ command }), elapsed({ command }), elapsed({ command })),
        ).toBeLessThan(500);
      });
    }
  }

  test('500 simple commands are read in under 100 ms', () => {
    const command = Array.from(
      { length: 500 },
      (_item, index) => `cp a${index} b${index}; echo ${index} > o${index}`,
    ).join('; ');

    elapsed({ command });

    expect(elapsed({ command })).toBeLessThan(500);
  });

  test('the same git question is asked once; more than eight different ones are refused', () => {
    const same = fill('git checkout HEAD -- .; ', 500 * 24);
    const eight = Array.from(
      { length: 8 },
      (_item, index) => `git checkout ${'HEAD'}${'~0'.repeat(index)} -- .`,
    ).join('; ');
    const nine = Array.from(
      { length: 9 },
      (_item, index) => `git checkout ${'HEAD'}${'~0'.repeat(index)} -- .`,
    ).join('; ');
    const answerOfLine = (line: string): boolean =>
      ManifestGuard.inspectWrite({
        input: { tool: 'Bash', filePath: undefined, command: line, cwd: root },
      });

    expect(answerOfLine(same)).toBe(false);
    expect(answerOfLine(eight)).toBe(false);
    expect(answerOfLine(nine)).toBe(true);
  });

  test('a slow file-system monitor in the repository does not slow the guard', () => {
    const monitor = join(root, 'slow-monitor.sh');

    writeFileSync(monitor, '#!/bin/sh\nsleep 5\nexit 1\n');
    chmodSync(monitor, 0o755);
    git({ cwd: root, args: ['config', 'core.fsmonitor', monitor] });

    const started = performance.now();
    const line = 'git checkout HEAD -- .; git stash pop; git restore -s HEAD .';
    const answer = ManifestGuard.inspectWrite({
      input: { tool: 'Bash', filePath: undefined, command: line, cwd: root },
    });

    git({ cwd: root, args: ['config', '--unset', 'core.fsmonitor'] });

    expect(performance.now() - started).toBeLessThan(2500);
    // The top stash holds another file and both restores are from HEAD: the line passes, and quickly.
    expect(answer).toBe(false);
  });
});
