import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ManifestGuard } from '../../hooks/index.ts';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';
import { commitAll, git, initRepo } from '../git-repo.helper.ts';
import { MANIFEST, answerToCommand } from '../manifest-hook.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

interface ICase {
  name: string;
  command: string;
  blocked: boolean;
}

/** Every case whose answer is not the expected one, so a failure lists them all. */
const expectAnswers = (opts: { cases: ICase[]; cwd: string }): void => {
  const wrong = opts.cases
    .filter(
      (item) =>
        answerToCommand({ command: item.command, cwd: opts.cwd }) !==
        (item.blocked ? 'deny' : undefined),
    )
    .map(
      (item) =>
        `${item.blocked ? 'allowed, should deny' : 'denied, should allow'}: ${item.name}: ${item.command.slice(0, 120)}`,
    );

  expect(wrong).toEqual([]);
};

/** A repository whose manifest differs between HEAD~1 and HEAD, with the working file equal to HEAD. */
const historyRepo = (): string => {
  const root = createProject({
    files: {
      [MANIFEST]: '{"v":1}\n',
      'README.md': 'a\n',
      'docs/a.md': 'a\n',
      '.agents/rules.md': 'r\n',
    },
  });

  initRepo({ cwd: root });
  writeFileSync(join(root, MANIFEST), '{"v":2}\n');
  commitAll({ cwd: root });

  return root;
};

const SOURCE_CASES: ICase[] = [
  { name: 'whole tree from a revision', command: 'git checkout HEAD~1 -- .', blocked: true },
  { name: 'restore with a source', command: 'git restore -s HEAD~1 .', blocked: true },
  { name: 'restore with a long source', command: 'git restore --source=HEAD~1 .', blocked: true },
  { name: 'top-level pathspec', command: "git checkout HEAD~1 -- ':/'", blocked: true },
  { name: 'top magic pathspec', command: "git checkout HEAD~1 -- ':(top)'", blocked: true },
  { name: 'star pattern', command: "git checkout HEAD~1 -- '*'", blocked: true },
  { name: 'dot-star pattern', command: "git checkout HEAD~1 -- '.*'", blocked: true },
  { name: 'a json pattern', command: "git restore -s HEAD~1 -- '*.json'", blocked: true },
  { name: 'no-overlay', command: 'git checkout --no-overlay HEAD~1 -- .', blocked: true },
  { name: 'a revision that does not exist', command: 'git checkout nosuchrev -- .', blocked: true },
  { name: 'the same revision as the file', command: 'git checkout HEAD -- .', blocked: false },
  { name: 'from the index', command: 'git checkout -- .', blocked: false },
  { name: 'restore from the index', command: 'git restore .', blocked: false },
  { name: 'the index only', command: `git restore --staged ${MANIFEST}`, blocked: false },
  {
    name: 'the index only, from a source',
    command: 'git restore -s HEAD~1 --staged .',
    blocked: false,
  },
  {
    name: 'a folder that does not hold it',
    command: 'git checkout HEAD~1 -- docs',
    blocked: false,
  },
  { name: 'another file by pattern', command: "git checkout HEAD~1 -- '*.md'", blocked: false },
];

const FOLDER_CASES: ICase[] = [
  {
    name: 'after cd into .agents',
    command: 'cd .agents && git checkout HEAD~1 -- .',
    blocked: true,
  },
  { name: 'under -C', command: 'git -C .agents checkout HEAD~1 -- .', blocked: true },
  { name: 'under -C, restore', command: 'git -C .agents restore -s HEAD~1 .', blocked: true },
  { name: 'cd into docs', command: 'cd docs && git checkout HEAD~1 -- .', blocked: false },
  { name: 'under -C docs', command: 'git -C docs checkout HEAD~1 -- .', blocked: false },
];

const ALIAS_CASES: ICase[] = [
  {
    name: 'an alias in the command line',
    command: 'git -c alias.zz=checkout zz HEAD~1 -- .agents',
    blocked: true,
  },
  {
    name: 'an alias in git config',
    command: 'git config alias.zz checkout; echo .agents',
    blocked: true,
  },
  { name: 'another -c setting', command: 'git -c core.pager=cat log -1', blocked: false },
  {
    name: 'an alias with no .agents on the line',
    command: 'git -c alias.zz=status zz',
    blocked: false,
  },
];

describe('git checkout and restore with a source', () => {
  test('a pathspec that covers the manifest is refused when the file differs or cannot be compared', () => {
    expectAnswers({ cases: SOURCE_CASES, cwd: historyRepo() });
  });

  test('the folder git runs in decides what a pathspec covers', () => {
    expectAnswers({ cases: FOLDER_CASES, cwd: historyRepo() });
  });

  test('an alias on a line that mentions .agents is refused', () => {
    expectAnswers({ cases: ALIAS_CASES, cwd: historyRepo() });
  });
});

describe('git apply, git am and patch', () => {
  const repoWithPatches = (): string => {
    const root = historyRepo();

    writeFileSync(join(root, 'README.md'), 'b\n');
    writeFileSync(join(root, 'readme.patch'), `${git({ cwd: root, args: ['diff'] })}\n`);
    git({ cwd: root, args: ['checkout', '--', 'README.md'] });
    writeFileSync(join(root, MANIFEST), '{"v":3}\n');
    writeFileSync(join(root, 'manifest.patch'), `${git({ cwd: root, args: ['diff'] })}\n`);
    git({ cwd: root, args: ['checkout', '--', MANIFEST] });
    spawnSyncBounded({ cmd: ['mkfifo', join(root, 'pipe.patch')] });
    mkdirSync(join(root, 'patches'));

    return root;
  };

  const CASES: ICase[] = [
    { name: 'a patch from stdin by name', command: 'git apply -', blocked: true },
    { name: 'a patch from a pipe', command: 'cat readme.patch | git apply', blocked: true },
    { name: 'a patch from a pipe, am', command: 'cat readme.patch | git am', blocked: true },
    { name: 'a patch from /dev/stdin', command: 'git apply /dev/stdin', blocked: true },
    { name: 'a process substitution', command: 'git apply <(cat readme.patch)', blocked: true },
    {
      name: 'a redirect from a process substitution',
      command: 'git apply < <(cat readme.patch)',
      blocked: true,
    },
    { name: 'a file that does not exist yet', command: 'git apply later.patch', blocked: true },
    {
      name: 'a file made on the same line',
      command: 'echo x > later.patch && git apply later.patch',
      blocked: true,
    },
    { name: 'a named pipe', command: 'git apply pipe.patch', blocked: true },
    { name: 'a folder', command: 'git am patches', blocked: true },
    { name: 'a patch of the manifest', command: 'git apply manifest.patch', blocked: true },
    {
      name: 'patch, a patch of the manifest',
      command: 'patch -p1 < manifest.patch',
      blocked: true,
    },
    {
      name: 'patch -i, a patch of the manifest',
      command: 'patch -p1 -i manifest.patch',
      blocked: true,
    },
    { name: 'patch from a pipe', command: 'cat readme.patch | patch -p1', blocked: true },
    { name: 'a patch of another file', command: 'git apply readme.patch', blocked: false },
    {
      name: 'a patch of another file, redirect',
      command: 'git apply < readme.patch',
      blocked: false,
    },
    { name: 'a patch of another file, am', command: 'git am readme.patch', blocked: false },
    {
      name: 'a patch of another file, patch -i',
      command: 'patch -p1 -i readme.patch',
      blocked: false,
    },
    { name: 'patch -p1 with a redirect', command: 'patch -p1 < readme.patch', blocked: false },
    { name: 'a check only', command: 'git apply --check manifest.patch', blocked: false },
    { name: 'stat only', command: 'git apply --stat manifest.patch', blocked: false },
  ];

  test('a patch that cannot be read in full is refused; a readable one that leaves the manifest alone passes', () => {
    expectAnswers({ cases: CASES, cwd: repoWithPatches() });
  });

  test('a named pipe does not hang the hook', () => {
    const root = repoWithPatches();
    const started = Date.now();

    expect(answerToCommand({ command: 'git apply pipe.patch', cwd: root })).toBe('deny');
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe('in-place editors and programs that extract or copy trees', () => {
  const CASES: ICase[] = [
    { name: 'sed -i with a suffix', command: `sed -ibak 's/a/b/' ${MANIFEST}`, blocked: true },
    { name: 'sed -i.bak', command: `sed -i.bak 's/a/b/' ${MANIFEST}`, blocked: true },
    {
      name: 'sed --in-place=.bak',
      command: `sed --in-place=.bak 's/a/b/' ${MANIFEST}`,
      blocked: true,
    },
    { name: 'perl -pi', command: `perl -pi -e 's/a/b/' ${MANIFEST}`, blocked: true },
    { name: 'perl -i.bak', command: `perl -i.bak -pe 's/a/b/' ${MANIFEST}`, blocked: true },
    { name: 'ruby -i', command: `ruby -i -pe 'sub("a","b")' ${MANIFEST}`, blocked: true },
    { name: 'awk -i inplace', command: `awk -i inplace '{print}' ${MANIFEST}`, blocked: true },
    { name: 'gawk -i inplace', command: `gawk -i inplace '{print}' ${MANIFEST}`, blocked: true },
    { name: 'ed', command: `ed -s ${MANIFEST}`, blocked: true },
    { name: 'ex', command: `ex -s ${MANIFEST}`, blocked: true },
    { name: 'vi -es', command: `vi -es ${MANIFEST}`, blocked: true },
    { name: 'vim -es', command: `vim -es ${MANIFEST}`, blocked: true },
    {
      name: 'rsync into the folder',
      command: 'rsync -a /tmp/pack/.agents/ .agents/',
      blocked: true,
    },
    { name: 'tar x into the folder', command: 'tar xf /tmp/p.tar -C .agents', blocked: true },
    { name: 'tar -x', command: 'tar -xzf /tmp/p.tgz .agents', blocked: true },
    { name: 'unzip into the folder', command: 'unzip -o /tmp/p.zip -d .agents', blocked: true },
    {
      name: 'cp -r of a folder named .agents',
      command: 'cp -r /tmp/pack/.agents .',
      blocked: true,
    },
    { name: 'cp -rT onto the folder', command: 'cp -rT /tmp/pack .agents', blocked: true },
    {
      name: 'cp onto the folder with a trailing slash',
      command: 'cp -r /tmp/pack/. .agents/',
      blocked: true,
    },
    {
      name: 'cp of a file of that name into the folder',
      command: 'cp /tmp/vulcan.manifest.json .agents/',
      blocked: true,
    },
    {
      name: 'install onto the manifest',
      command: `install -m 644 /tmp/m.json ${MANIFEST}`,
      blocked: true,
    },
    { name: 'rm -rf of the folder', command: 'rm -rf .agents', blocked: true },
    { name: 'rm -rf of the folder, slash', command: 'rm -rf .agents/', blocked: true },
    { name: 'mv onto the folder', command: 'mv /tmp/x .agents', blocked: true },
    { name: 'mv of the folder', command: 'mv .agents /tmp/x', blocked: true },
    { name: 'find -delete in the folder', command: 'find .agents -name x -delete', blocked: true },
    {
      name: 'find -exec in the folder',
      command: 'find .agents -name x -exec rm {} +',
      blocked: true,
    },
    {
      name: 'xargs rm with the folder on the line',
      command: `echo ${MANIFEST} | xargs rm`,
      blocked: true,
    },
    {
      name: 'xargs cp with the folder on the line',
      command: 'echo .agents/rules.md | xargs -I{} cp /tmp/x {}',
      blocked: true,
    },
    { name: 'sed -n of the manifest', command: `sed -n p ${MANIFEST}`, blocked: false },
    { name: 'grep -i of the manifest', command: `grep -i manifest ${MANIFEST}`, blocked: false },
    { name: 'perl -ne of the manifest', command: `perl -ne 'print' ${MANIFEST}`, blocked: false },
    { name: 'awk of the manifest', command: `awk '{print}' ${MANIFEST}`, blocked: false },
    { name: 'sed -i on another file', command: "sed -i 's/a/b/' src/a.ts", blocked: false },
    {
      name: 'sed -i on a knowledge file',
      command: "sed -i.bak 's/a/b/' .agents/knowledge/x.md",
      blocked: false,
    },
    { name: 'rm under .agents/local', command: 'rm -rf .agents/local/tmp/x', blocked: false },
    {
      name: 'rm of a glob under .agents/local',
      command: 'rm -rf .agents/local/tmp/*',
      blocked: false,
    },
    { name: 'cat in the folder', command: 'cat .agents/rules.md', blocked: false },
    { name: 'copy of the folder elsewhere', command: 'cp -r .agents /tmp/backup', blocked: false },
    {
      name: 'cp of a file into a subfolder',
      command: 'cp notes.md .agents/knowledge/',
      blocked: false,
    },
    { name: 'find without an action', command: "find .agents -name '*.md'", blocked: false },
    {
      name: 'find -delete under .agents/local',
      command: 'find .agents/local -name x -delete',
      blocked: false,
    },
    { name: 'tar x elsewhere', command: 'tar xf /tmp/p.tar -C /tmp/out', blocked: false },
    { name: 'tar c of the folder', command: 'tar czf /tmp/out.tgz .agents', blocked: false },
    { name: 'tar t of an archive', command: 'tar tf /tmp/p.tar', blocked: false },
    { name: 'rsync elsewhere', command: 'rsync -a src/ dist/', blocked: false },
    { name: 'unzip elsewhere', command: 'unzip -o /tmp/p.zip -d /tmp/out', blocked: false },
    { name: 'xargs with no .agents on the line', command: 'ls | xargs rm', blocked: false },
  ];

  test('each form that can replace the manifest is refused; the reads and the other files pass', () => {
    expectAnswers({ cases: CASES, cwd: '/work/project' });
  });
});

describe('globs and expansions in a write target', () => {
  const CASES: ICase[] = [
    { name: 'tee with a glob', command: 'echo x | tee .agents/vulcan.m*', blocked: true },
    {
      name: 'redirect with a command substitution',
      command: 'echo x > .agents/$(echo vulcan.manifest.json)',
      blocked: true,
    },
    {
      name: 'redirect with a variable',
      command: 'F=vulcan.manifest.json; echo x > .agents/$F',
      blocked: true,
    },
    { name: 'redirect with braces', command: 'echo x > .agents/${F}', blocked: true },
    {
      name: 'redirect with a backtick',
      command: 'echo x > .agents/`echo v`ulcan.manifest.json',
      blocked: true,
    },
    {
      name: 'a question mark',
      command: 'cp /tmp/m.json .agents/vulcan.manifes?.json',
      blocked: true,
    },
    { name: 'a bracket', command: 'cp /tmp/m.json .agents/vulcan.manifest.[j]son', blocked: true },
    { name: 'after cd .agents, a glob', command: 'cd .agents && echo x > v*', blocked: true },
    { name: 'after cd .agents, a variable', command: 'cd .agents && echo x > $F', blocked: true },
    {
      name: 'a decoded name with .agents on the line',
      command: 'cp x "$(echo dnVsY2FuLm1hbmlmZXN0Lmpzb24= | base64 -d)"; ls .agents',
      blocked: true,
    },
    { name: 'rm with a star in the folder', command: 'rm .agents/*', blocked: true },
    { name: 'rm with a dot-star', command: 'rm -rf .*', blocked: true },
    { name: 'a glob that cannot match', command: 'rm -f .agents/local/tmp/*.log', blocked: false },
    {
      name: 'a substitution in a subfolder name',
      command: 'echo hi > .agents/local/$(date +%s).log',
      blocked: false,
    },
    {
      name: 'a variable in a subfolder name',
      command: 'echo hi > .agents/local/$NAME.log',
      blocked: false,
    },
    {
      name: 'a substitution with no .agents on the line',
      command: 'cp a.txt "$(mktemp)"',
      blocked: false,
    },
    {
      name: 'a variable redirect with no .agents on the line',
      command: 'echo hi > $LOG',
      blocked: false,
    },
    { name: 'a glob elsewhere', command: 'rm -f dist/*.js', blocked: false },
    { name: 'a glob for reading', command: 'cat .agents/*.md', blocked: false },
    {
      name: 'after cd .agents, a glob that cannot match',
      command: 'cd .agents && echo x > notes*',
      blocked: false,
    },
  ];

  test('a target that could name the manifest is refused when .agents is in play; one that cannot passes', () => {
    expectAnswers({ cases: CASES, cwd: '/work/project' });
  });
});

describe('a line the parser cannot read in full', () => {
  const filler = 'echo a; '.repeat(2100);

  test('is refused when it mentions .agents and holds a write or rewrite verb', () => {
    const cases: ICase[] = [
      { name: 'cp', command: `${filler}cp /tmp/x .agents/foo`, blocked: true },
      { name: 'redirect', command: `${filler}echo x > .agents/foo`, blocked: true },
      { name: 'git checkout', command: `${filler}git checkout HEAD~1 -- .agents`, blocked: true },
      { name: 'tar', command: `${filler}tar xf p.tar -C .agents`, blocked: true },
      { name: 'python', command: `${filler}python3 x.py .agents`, blocked: true },
      {
        name: 'a name fragment and a write verb',
        command: `${filler}cp /tmp/x vulcan.mani*`,
        blocked: true,
      },
      { name: 'no .agents', command: `${filler}ls`, blocked: false },
      { name: 'no verb', command: `${filler}cat .agents/rules.md`, blocked: false },
    ];

    expectAnswers({ cases, cwd: '/work/project' });
  });

  test('a long line and many commands are read in tens of milliseconds', () => {
    const many = Array.from({ length: 500 }, (_, index) => `echo ${index} > out${index}.txt`).join(
      '; ',
    );
    const long = `echo ${'x'.repeat(90_000)} > out.txt`;

    for (const command of [many, long]) {
      const started = performance.now();

      expect(
        ManifestGuard.inspectWrite({
          input: { tool: 'Bash', filePath: undefined, command, cwd: '/work/project' },
        }),
      ).toBe(false);
      expect(performance.now() - started).toBeLessThan(250);
    }
  });
});

describe('inline scripts that read, print or write elsewhere', () => {
  const CASES: ICase[] = [
    {
      name: 'stdout.write of the manifest',
      command: `bun -e "process.stdout.write(await Bun.file('${MANIFEST}').text())"`,
      blocked: false,
    },
    {
      name: 'console.error',
      command: `bun -e "console.error(await Bun.file('${MANIFEST}').text())"`,
      blocked: false,
    },
    {
      name: 'python sys.stdout.write',
      command: `python3 -c "import sys; sys.stdout.write(open('${MANIFEST}').read())"`,
      blocked: false,
    },
    {
      name: 'python open in read mode',
      command: `python3 -c "print(open('${MANIFEST}', 'r').read())"`,
      blocked: false,
    },
    { name: 'grep -i', command: `grep -i manifest ${MANIFEST}`, blocked: false },
    {
      name: 'a write to another literal path that reads the manifest',
      command: `bun -e "const m = await Bun.file('${MANIFEST}').json(); await Bun.write('dist/manifest.json', JSON.stringify(m))"`,
      blocked: false,
    },
    {
      name: 'python writing another literal path while reading the manifest',
      command: `python3 -c "import json; m = json.load(open('${MANIFEST}')); open('out/manifest.json', 'w').write(json.dumps(m))"`,
      blocked: false,
    },
    {
      name: 'a write to a variable target with no .agents or name in play',
      command: `bun -e "const out = process.argv[1]; await Bun.write(out, 'x')" notes.txt`,
      blocked: false,
    },
    {
      name: 'a write to a variable target that holds the path',
      command: `bun -e "const f = '${MANIFEST}'; await Bun.write(f, '{}')"`,
      blocked: true,
    },
    {
      name: 'a write to a variable target beside a name fragment',
      command: `bun -e "const f = 'manifest.json'; require('fs').writeFileSync(process.env.OUT, f)"`,
      blocked: true,
    },
    {
      name: 'a copy whose destination is the manifest, as a literal',
      command: `python3 -c "import shutil; shutil.copy('/tmp/m.json', '${MANIFEST}')"`,
      blocked: true,
    },
    {
      name: 'a move onto the manifest',
      command: `node -e "require('fs').renameSync('/tmp/m.json', '${MANIFEST}')"`,
      blocked: true,
    },
    {
      name: 'a removal of the manifest in python',
      command: `python3 -c "import os; os.remove('${MANIFEST}')"`,
      blocked: true,
    },
    {
      name: 'a shell-out from a script',
      command: `node -e "require('child_process').execSync('cp /tmp/m.json .agents/vulcan.mani*')"`,
      blocked: true,
    },
    {
      name: 'a write with a computed call name',
      command: `node -e "require('fs')['write'+'FileSync']('.agents/vulcan.mani'+'fest.json','{}')"`,
      blocked: true,
    },
  ];

  test('only a write whose target can be the manifest is refused', () => {
    expectAnswers({ cases: CASES, cwd: '/work/project' });
  });
});
