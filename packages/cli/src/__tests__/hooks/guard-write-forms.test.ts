import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { OutsideGuard } from '../../hooks/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const project = (): string => {
  const root = createProject({ files: { 'package.json': '{}', 'src/a.ts': 'x' } });

  for (const folder of ['.agents/local/tmp', '.claude', '.configs', '.codex', 'dist']) {
    mkdirSync(join(root, folder), { recursive: true });
  }

  return root;
};

const hitsOf = (opts: { root: string; command: string }) =>
  OutsideGuard.inspect({
    input: { tool: 'Bash', command: opts.command, cwd: opts.root, filePath: undefined },
    projectRoot: opts.root,
    env: { HOME: '/nonexistent-home' },
  });

const root = project();
const isDenied = (command: string): boolean =>
  hitsOf({ root, command }).some((hit) => hit.isProtected === true);
const isSilent = (command: string): boolean => hitsOf({ root, command }).length === 0;

/** Folders that hold a file the guards read, with the name of one such file in each. */
const FOLDERS: [string, string][] = [
  ['.agents', 'vulcan.manifest.json'],
  ['.agents/local', 'claude.launch.settings.json'],
  ['.agents/local/hooks', 'guard-git.js'],
  ['.claude', 'settings.json'],
  ['.claude', 'settings.local.json'],
  ['.configs', 'vulcan.config.mts'],
  ['.codex', 'hooks.json'],
  ['.agents', 'hooks.json'],
  ['.omp/hooks/pre', 'vulcan-guards.ts'],
  ['.pi/extensions', 'vulcan-guards.ts'],
];

describe('a copy, a move, an install or a link into the folder of a protected file names that file', () => {
  test.each(
    FOLDERS.flatMap(([folder, name]) =>
      [
        `cp y/${name} ${folder}/`,
        `cp y/${name} ${folder}`,
        `cp -f y/${name} ${folder}/`,
        `cp -t ${folder} y/${name}`,
        `cp --target-directory=${folder} y/${name}`,
        `install -m 644 y/${name} ${folder}/`,
        `install -t ${folder} y/${name}`,
        `mv x/${name} ${folder}/`,
        `mv -t ${folder} x/${name}`,
        `rsync -a y/${name} ${folder}/`,
        `ln -sf /tmp/x/${name} ${folder}/`,
        `cp a b y/${name} ${folder}/`,
        `cp y/${name} dist/../${folder}/`,
        `cd ${folder} && cp ../y/${name} .`,
        `cp y/${name} ${folder.toUpperCase()}/`,
      ].map((command) => ({ command })),
    ),
  )('$command is denied', ({ command }) => {
    expect(isDenied(command)).toBe(true);
  });

  test.each([
    'cp notes.md .claude/',
    'cp notes.md .agents/local/tmp/',
    'cp -t .agents/local/tmp notes.md',
    'install -m 644 notes.md -t .configs',
    'mv notes.md .codex/',
    'rsync -a srcdir .agents/local/tmp/',
    'cp .claude/settings.json dist/',
    'mv a b',
    'cp a b dist/',
  ])('%s passes: the name it writes is not a protected file', (command) => {
    expect(isSilent(command)).toBe(true);
  });
});

describe('names this check cannot tell, put into the folder of a protected file', () => {
  const FORMS: [string, (folder: string) => string][] = [
    ['a variable source', (folder) => `cp $f ${folder}/`],
    ['a glob source', (folder) => `cp y/* ${folder}/`],
    ['a command substitution', (folder) => `cp $(ls y) ${folder}/`],
    ['the contents of a folder, cp -a dir/.', (folder) => `cp -a srcdir/. ${folder}/`],
    ['a source ending in ..', (folder) => `cp -a srcdir/inner/.. ${folder}/`],
    ['cp -aT', (folder) => `cp -aT srcdir ${folder}`],
    ['cp -rT', (folder) => `cp -rT srcdir ${folder}`],
    ['cp --no-target-directory', (folder) => `cp -a --no-target-directory srcdir ${folder}`],
    ['rsync of the contents, srcdir/', (folder) => `rsync -a srcdir/ ${folder}/`],
    ['rsync of the contents, srcdir/.', (folder) => `rsync -a srcdir/. ${folder}`],
    ['tar -xf with -C', (folder) => `tar -xf a.tar -C ${folder}`],
    ['tar xf with -C', (folder) => `tar xf a.tar -C ${folder}`],
    ['tar with --directory=', (folder) => `tar --directory=${folder} -xzf a.tgz`],
    ['tar --extract', (folder) => `tar --extract --file a.tar --directory ${folder}`],
    ['tar after a cd', (folder) => `cd ${folder} && tar xf ../a.tar`],
    ['tar into the project root', () => 'tar -xf a.tar'],
    ['unzip into the project root', () => 'unzip a.zip'],
    ['unzip -d', (folder) => `unzip a.zip -d ${folder}`],
    ['unzip -o -d', (folder) => `unzip -o a.zip -d ${folder}`],
    ['unzip after a cd', (folder) => `cd ${folder} && unzip ../a.zip`],
    ['ln -sfn onto the folder', (folder) => `ln -sfn /tmp ${folder}`],
    ['ln -sT onto the folder', (folder) => `ln -sT /tmp ${folder}`],
  ];

  test.each(
    FORMS.flatMap(([form, make]) =>
      ['.agents/local', '.claude', '.configs', '.codex', '.agents'].map((folder) => ({
        form,
        command: make(folder),
      })),
    ),
  )('$form: $command is denied', ({ command }) => {
    expect(isDenied(command)).toBe(true);
  });

  test.each([
    'cp $f .agents/local/tmp/',
    'cp -a srcdir/. dist/',
    'cp -aT srcdir dist',
    'rsync -a srcdir/ dist/',
    'tar xf a.tar -C dist',
    'cd dist && tar -xf ../a.tar',
    'cd dist && unzip ../a.zip',
    'unzip a.zip -d dist',
    'unzip -l a.zip',
    'unzip -t a.zip',
    'unzip -p a.zip x',
    'tar -tf a.tar',
    'tar -cf dist/out.tar src',
    'ln -sfn /tmp dist/link',
  ])('%s passes: the folder holds no protected file', (command) => {
    expect(isSilent(command)).toBe(true);
  });
});

describe('the folders above the installed package cannot be replaced', () => {
  test.each([
    'rsync -a evil/ node_modules/',
    'rsync -a evil/ node_modules',
    'cp -r evil/. node_modules',
    'cp -aT evil node_modules',
    'tar xf evil.tar -C node_modules',
    'tar xf evil.tar -C node_modules/@venizia',
    'unzip -o evil.zip -d node_modules',
    'cd node_modules && tar xf ../evil.tar',
    'cd node_modules/@venizia && unzip ../../evil.zip',
    'cp -r evil/@venizia node_modules',
    'cp -a evil/@venizia node_modules/',
    'mv evil/@venizia node_modules/',
    'mv -t node_modules evil/@venizia',
    'rsync -a evil/@venizia node_modules/',
    'rm -rf node_modules/@venizia && cp -r evil node_modules/@venizia',
    'rm -rf node_modules/@venizia && mv evil node_modules/@venizia',
    'mv node_modules nm && mv evil node_modules',
    'rm -rf node_modules && cp -r evil node_modules',
    'rm -rf node_modules && mv evil node_modules',
    'rm -rf node_modules && ln -s /tmp/evil node_modules',
    'rm -rf node_modules/@venizia && ln -s /tmp/evil node_modules/@venizia',
    'cp -r evil node_modules/@venizia/vulcan',
    'echo x > node_modules/@venizia/vulcan/base/hooks/guard-outside.ts',
  ])('%s is denied', (command) => {
    expect(isDenied(command)).toBe(true);
  });

  test.each([
    'rm -rf node_modules',
    'mv node_modules nm',
    'rm -rf node_modules/@venizia',
    'cp pkg.tgz node_modules/',
    'cp x node_modules/foo',
    'mv x node_modules/foo',
    'ln -s ../x node_modules/@scope/x',
    'ln -s ../x node_modules/@venizia/other',
    'cp -r evil node_modules/@venizia/other',
    'rsync -a dist/ node_modules/.cache/',
    'tar xf cache.tgz -C node_modules/.cache',
    'mkdir -p node_modules/.cache',
    'cd node_modules && ls',
  ])('%s passes: the package itself is not touched', (command) => {
    expect(isSilent(command)).toBe(true);
  });
});

describe('find runs a writer over a protected file', () => {
  test.each([
    "find . -name '*.json' -exec sed -i s/deny/allow/ {} +",
    'find . -name settings.json -exec mv {} {}.bak ;',
    'find .claude -exec truncate -s0 {} ;',
    'find .claude -type f -exec sed -i s/a/b/ {} +',
    'find .claude -exec perl -pi -e s/a/b/ {} +',
    'find .claude -exec cp /tmp/x {} ;',
    'find .claude -exec tee {} ;',
    'find .claude -exec dd of={} ;',
    'find .claude -exec ln -sf /tmp/x {} ;',
    'find .claude -execdir install -m 644 /tmp/x {} ;',
    'find .claude -ok mv {} /tmp/ ;',
    'find .claude -exec shred -u {} ;',
    "find .agents -name 'hooks.json' -exec rsync /tmp/x {} ;",
    "find .agents/local -name '*.json' -exec sed --in-place s/a/b/ {} +",
  ])('%s is denied', (command) => {
    expect(isDenied(command)).toBe(true);
  });

  test.each([
    'find src -exec sed -i s/a/b/ {} +',
    'find src -name "*.ts" -exec mv {} dist/ ;',
    "find . -name '*.log' -exec mv {} dist/ ;",
    'find .claude -exec cat {} ;',
    'find .claude -exec sed -n 1p {} ;',
    'find .claude -exec perl -ne print {} ;',
    "find .claude -name '*.log' -exec truncate -s0 {} ;",
    'find .agents/local/tmp -exec truncate -s0 {} ;',
  ])('%s passes', (command) => {
    expect(isSilent(command)).toBe(true);
  });
});

describe('a pattern in a removal reaches a protected file', () => {
  test.each([
    'rm -rf .agents/local/*',
    'rm .agents/local/claude.*',
    'rm .agents/local/c*',
    'rm -f .agents/local/claude.launch.settings.js?n',
    'rm -rf .claude/*',
    'rm .claude/settings.*',
    'rm .claude/settings.local.json .claude/s*',
    'rm -rf .configs/*',
    'rm .configs/vulcan.*',
    'rm -rf .agents/*',
    'rm -rf .*',
    'rm -rf .a*',
    'rm -rf .[ac]*',
    'rm -rf ./.claude/*',
    'rm -rf .codex/*',
    'rm -rf .omp/hooks/pre/*',
    'rm -rf .pi/extensions/*',
    'cd .claude && rm -rf *',
    'cd .agents/local && rm claude.*',
    'unlink .claude/settings.*',
    'shred -u .claude/*',
    'git rm .claude/*',
    'mv .claude/* dist/',
    'sed -i s/a/b/ .claude/*.json',
    'truncate -s 0 .claude/settings.*',
    'perl -pi -e s/a/b/ .agents/local/claude.*',
  ])('%s is denied', (command) => {
    expect(isDenied(command)).toBe(true);
  });

  test.each([
    'rm -rf src/*',
    'rm -rf *',
    'rm -rf dist/*',
    'rm -rf .agents/local/tmp/*',
    'rm -rf .agents/local/tmp/x*',
    'rm .claude/nothing-*',
    'rm -rf ./*',
    'rm -f *.log',
    'cd dist && rm -rf *',
  ])('%s passes: nothing the guards read can match', (command) => {
    expect(isSilent(command)).toBe(true);
  });
});

describe('find and git clean delete a protected file', () => {
  test.each([
    "find .agents/local -name '*.json' -delete",
    "find .claude -name 'settings*' -delete",
    "find . -name '*.json' -delete",
    "find . -name 'claude.*' -delete",
    "find . -iname 'SETTINGS.JSON' -delete",
    'find .agents/local -delete',
    'find .claude -type f -delete',
    'find . -type f -delete',
    'find . -delete',
    'find .agents -exec rm {} +',
    'find .claude -exec rm -f {} ;',
    'find .claude -execdir unlink {} ;',
    "find .claude -name '*.log' -o -name 'x' -delete",
    "find .claude ! -name '*.log' -delete",
    "find -L .claude -name '*.json' -delete",
    'git clean -fdX',
    'git clean -fdx',
    'git clean -fx',
    'git clean -X -f',
    'git clean -fdx .agents',
    'git clean -fdX .claude',
    'git clean -fdx .',
    'git -C . clean -fdX',
    'cd .claude && git clean -fdx',
  ])('%s is denied', (command) => {
    expect(isDenied(command)).toBe(true);
  });

  test.each([
    "find . -name '*.log' -delete",
    "find .agents/local/tmp -name '*.log' -delete",
    'find .agents/local/tmp -delete',
    "find src -name '*.json' -delete",
    'find src -delete',
    'find dist -type f -delete',
    "find .claude -name '*.log' -delete",
    'find .claude -name x',
    'find . -name settings.json',
    'find .claude -exec cat {} ;',
    'git clean -fd',
    'git clean -f',
    'git clean -ndX',
    'git clean -n -x',
    'git clean -fdx src',
    'git clean -fdx dist',
    'git clean --dry-run -fdx',
  ])('%s passes', (command) => {
    expect(isSilent(command)).toBe(true);
  });
});

describe('the files the agent integrations write are protected', () => {
  test.each([
    '.codex/hooks.json',
    '.agents/hooks.json',
    '.omp/hooks/pre/vulcan-guards.ts',
    '.pi/extensions/vulcan-guards.ts',
  ])('%s is denied in every form', (path) => {
    for (const command of [
      `echo x > ${path}`,
      `echo x >> ${path}`,
      `tee ${path}`,
      `cp y ${path}`,
      `mv y ${path}`,
      `mv ${path} y`,
      `rm ${path}`,
      `sed -i s/a/b/ ${path}`,
      `truncate -s 0 ${path}`,
      `ln -sf /tmp/x ${path}`,
      `dd if=/dev/null of=${path}`,
      `perl -pi -e s/a/b/ ${path}`,
    ]) {
      expect(isDenied(command), command).toBe(true);
    }
  });
});

describe('an in-place edit, an extraction and a git init are writes', () => {
  const outside = (command: string): boolean => {
    const hits = hitsOf({ root, command });

    return hits.length > 0 && hits.every((hit) => hit.isProtected !== true);
  };

  test.each([
    'sed -i s/a/b/ /etc/hosts',
    'sed -i -e s/a/b/ /etc/hosts',
    'sed -i.bak s/a/b/ /etc/hosts',
    'sed -ni 1p /etc/hosts',
    'sed --in-place s/a/b/ /etc/hosts',
    'sed -i -f script.sed /etc/hosts',
    'perl -pi -e s/a/b/ /etc/hosts',
    'perl -i.bak -pe s/a/b/ /etc/hosts',
    'truncate -s 0 /etc/hosts',
    'truncate --size=0 /etc/hosts',
    'tar xf a.tar -C /tmp/x',
    'tar -xzf a.tgz --directory=/tmp/x',
    'tar -cf /tmp/out.tar src',
    'tar czf /tmp/out.tgz src',
    'unzip a.zip -d /tmp/x',
    'unzip -o a.zip -d/tmp/x',
    'git init /tmp/x',
    'git -C /tmp/x init',
    'git init -b main /tmp/x',
    'cd /tmp && tar xf a.tar',
    'cd /tmp && unzip a.zip',
    'cd /tmp && git init',
  ])('%s is a write outside the project', (command) => {
    expect(outside(command)).toBe(true);
  });

  test.each([
    'sed -i s/a/b/ src/a.ts',
    'sed -i /x/d src/a.ts',
    'sed -i -e /x/d src/a.ts',
    'sed -n 1p /etc/hosts',
    'sed s/a/b/ /etc/hosts',
    'perl -pi -e s/a/b/ src/a.ts',
    'perl -ne print /etc/hosts',
    'truncate -s 0 src/a.ts',
    'tar xf a.tar -C dist',
    'tar -tf a.tar',
    'tar -cf dist/out.tar src',
    'unzip a.zip -d dist',
    'unzip -l a.zip',
    'git init',
    'git init dist/sub',
    'git -C dist init',
  ])('%s passes', (command) => {
    expect(isSilent(command)).toBe(true);
  });
});

describe("Bun's own copy of the installed package, and the bin the owner runs", () => {
  const STORE = 'node_modules/.bun/@venizia+vulcan@1';
  const PACKAGE = `${STORE}/node_modules/@venizia/vulcan`;
  /** A project laid out as Bun does: the package a link in node_modules/@venizia points into node_modules/.bun. */
  const linked = (): string => {
    const base = createProject({ files: { 'package.json': '{}' } });

    mkdirSync(join(base, PACKAGE, 'base', 'hooks'), { recursive: true });
    mkdirSync(join(base, 'node_modules', '@venizia'), { recursive: true });
    mkdirSync(join(base, 'node_modules', '.bin'), { recursive: true });
    mkdirSync(join(base, 'dist'), { recursive: true });
    symlinkSync(
      '../.bun/@venizia+vulcan@1/node_modules/@venizia/vulcan',
      join(base, 'node_modules', '@venizia', 'vulcan'),
    );

    return base;
  };
  const denied = (opts: { root: string; command: string }): boolean =>
    hitsOf(opts).some((hit) => hit.isProtected === true);

  const WRITES = [
    `echo x > ${PACKAGE}/base/hooks/guard-outside.ts`,
    `cp -r evil/@venizia/vulcan/. ${PACKAGE}`,
    `rsync -a evil/ ${PACKAGE}/`,
    'rsync -a evil/ node_modules/.bun/',
    `rm -rf ${STORE} && mv evil/x ${STORE}`,
    `rm -rf ${STORE} && cp -r evil ${STORE}`,
    'mv evil/x node_modules/.bun',
    'cp -r evil node_modules/.bun',
    `tar xf e.tar -C ${STORE}`,
    `tar xf e.tar -C ${PACKAGE}`,
    'tar xf e.tar -C node_modules/.bun',
    `unzip e.zip -d ${STORE}/node_modules/@venizia`,
    `cd ${STORE} && tar xf ../../../e.tar`,
    'cp -r evil/@venizia+vulcan@2 node_modules/.bun/',
    `sed -i s/a/b/ ${PACKAGE}/base/hooks/guard-outside.ts`,
    `rm ${PACKAGE}/base/hooks/guard-outside.ts`,
    `find ${PACKAGE} -name '*.ts' -delete`,
    'ln -sf ../../evil/cli.ts node_modules/.bin/vulcan',
    'cp evil/cli.ts node_modules/.bin/vulcan',
    'echo x > node_modules/.bin/vulcan',
    'cp -r evil node_modules/.bin',
    'mv evil node_modules/.bin',
    'rsync -a evil/ node_modules/.bin/',
    'tar xf e.tar -C node_modules/.bin',
    'rm node_modules/.bin/vulcan',
  ];

  test.each(WRITES)('with the package linked into the store: %s is denied', (command) => {
    expect(denied({ root: linked(), command })).toBe(true);
  });

  test.each(
    WRITES.filter((command) => command.includes('@venizia+vulcan@1') || command.includes('.bin')),
  )('with no link at all, the names still hold: %s is denied', (command) => {
    const bare = createProject({ files: { 'package.json': '{}' } });

    expect(denied({ root: bare, command })).toBe(true);
  });

  test.each([
    'rm -rf node_modules/.bun',
    'mv node_modules/.bun old',
    'ln -s ../x node_modules/.bin/other',
    'cp x node_modules/.bin/other',
    'rsync -a dist/ node_modules/.cache/',
    'echo x > node_modules/.bun/other@1/f',
    'cp x node_modules/.bun/other@1/f',
    `cat ${PACKAGE}/package.json`,
    `ls ${STORE}`,
    'bun node_modules/.bin/vulcan sync',
  ])('%s passes', (command) => {
    expect(denied({ root: linked(), command })).toBe(false);
  });

  test('a link to a source folder of a workspace is the project own code: only the link path is protected', () => {
    const base = createProject({
      files: { 'package.json': '{}', 'libs/guards/src/hooks.ts': 'x' },
    });

    mkdirSync(join(base, 'node_modules', '@venizia'), { recursive: true });
    symlinkSync('../../libs/guards', join(base, 'node_modules', '@venizia', 'vulcan'));

    for (const command of [
      'echo x > libs/guards/src/hooks.ts',
      'cp x libs/guards/src/',
      'rm -rf libs/guards/src/*',
      'sed -i s/a/b/ libs/guards/src/hooks.ts',
    ]) {
      expect(denied({ root: base, command }), command).toBe(false);
    }

    for (const command of [
      'echo x > node_modules/@venizia/vulcan/src/hooks.ts',
      'rsync -a evil/ node_modules/@venizia/',
    ]) {
      expect(denied({ root: base, command }), command).toBe(true);
    }
  });
});
