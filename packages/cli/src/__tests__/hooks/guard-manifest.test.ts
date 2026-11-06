import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ManifestGuard } from '../../hooks/index.ts';
import { git, initRepo } from '../git-repo.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import {
  FILE_KEY,
  MANIFEST,
  ROOT,
  answerOf,
  answerToCommand,
  runHook,
  wire,
} from '../manifest-hook.helper.ts';

afterAll(removeProjects);

const SETTINGS = join(import.meta.dir, '..', '..', '..', 'base', 'claude', 'settings.json');

const TOOL_CASES: { name: string; tool: string; path: string; blocked: boolean }[] = [
  { name: 'Write, relative', tool: 'Write', path: MANIFEST, blocked: true },
  { name: 'Edit, absolute', tool: 'Edit', path: `${ROOT}/${MANIFEST}`, blocked: true },
  { name: 'MultiEdit, dot-slash', tool: 'MultiEdit', path: `./${MANIFEST}`, blocked: true },
  {
    name: 'Edit, a path that climbs back in',
    tool: 'Edit',
    path: `x/../${MANIFEST}`,
    blocked: true,
  },
  {
    name: 'Write, another file in .agents',
    tool: 'Write',
    path: '.agents/rules.md',
    blocked: false,
  },
  {
    name: 'Write, a file of that name elsewhere',
    tool: 'Write',
    path: 'docs/manifest.json',
    blocked: false,
  },
  { name: 'Write, the config', tool: 'Write', path: '.configs/vulcan.config.mts', blocked: false },
];

const COMMAND_CASES: { name: string; command: string; blocked: boolean }[] = [
  { name: 'redirect', command: `echo '{}' > ${MANIFEST}`, blocked: true },
  { name: 'append', command: `echo '{}' >> ${MANIFEST}`, blocked: true },
  { name: 'redirect with no space', command: `cat x >${MANIFEST}`, blocked: true },
  { name: 'absolute redirect', command: `jq . x > ${ROOT}/${MANIFEST}`, blocked: true },
  { name: 'tee', command: `cat x | tee ${MANIFEST}`, blocked: true },
  { name: 'tee -a', command: `echo x | tee -a ${MANIFEST} > /dev/null`, blocked: true },
  { name: 'sed -i', command: `sed -i 's/a/b/' ${MANIFEST}`, blocked: true },
  { name: 'cp onto it', command: `cp /tmp/m.json ${MANIFEST}`, blocked: true },
  { name: 'mv onto it', command: `mv /tmp/m.json ${MANIFEST}`, blocked: true },
  { name: 'rm', command: `rm ${MANIFEST}`, blocked: true },
  { name: 'cat reads it', command: `cat ${MANIFEST}`, blocked: false },
  {
    name: 'jq reads it into a temp file',
    command: `jq .name ${MANIFEST} > /tmp/name`,
    blocked: false,
  },
  { name: 'cp from it', command: `cp ${MANIFEST} /tmp/backup.json`, blocked: false },
  { name: 'git diff of it', command: `git diff -- ${MANIFEST}`, blocked: false },
  { name: 'vulcan sync itself', command: 'bun x --no-install vulcan sync', blocked: false },
  { name: 'redirect elsewhere', command: 'echo x > notes.txt', blocked: false },
];

describe('ManifestGuard.inspectWrite', () => {
  for (const item of TOOL_CASES) {
    test(`${item.name}: ${item.blocked ? 'blocked' : 'allowed'}`, () => {
      expect(
        ManifestGuard.inspectWrite({
          input: { tool: item.tool, filePath: item.path, command: undefined, cwd: ROOT },
        }),
      ).toBe(item.blocked);
    });
  }

  for (const item of COMMAND_CASES) {
    test(`Bash ${item.name}: ${item.blocked ? 'blocked' : 'allowed'}`, () => {
      expect(
        ManifestGuard.inspectWrite({
          input: { tool: 'Bash', filePath: undefined, command: item.command, cwd: ROOT },
        }),
      ).toBe(item.blocked);
    });
  }
});

describe('ManifestGuard.parseHookInput', () => {
  test('reads the tool, the file path and the command from the wire form', () => {
    expect(
      ManifestGuard.parseHookInput({
        text: wire({ tool: 'Write', input: `{"file_path":"${MANIFEST}"}`, cwd: ROOT }),
      }),
    ).toEqual({ tool: 'Write', filePath: MANIFEST, command: undefined, cwd: ROOT });
  });

  test('a notebook edit carries notebook_path', () => {
    const input = ManifestGuard.parseHookInput({
      text: wire({ tool: 'NotebookEdit', input: '{"notebook_path":"a.ipynb"}' }),
    });

    expect(input?.filePath).toBe('a.ipynb');
  });

  test('anything that is not a JSON object is not input', () => {
    expect(ManifestGuard.parseHookInput({ text: 'not json' })).toBeUndefined();
    expect(ManifestGuard.parseHookInput({ text: '[]' })).toBeUndefined();
  });
});

describe('the decision', () => {
  test('denies, with the message that says what to edit instead', () => {
    const decision = ManifestGuard.buildDecision();

    expect(decision.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(decision.hookSpecificOutput.permissionDecisionReason).toBe(
      'vulcan.manifest.json is generated - edit .configs/vulcan.config.* and run `vulcan sync`',
    );
  });
});

describe('the hook script', () => {
  test('a Write to the manifest is denied with the message', () => {
    const result = runHook({
      payload: wire({ tool: 'Write', input: `{"file_path":"/tmp/p/${MANIFEST}"}` }),
    });
    const decision = JSON.parse(result.stdout);

    expect(result.code).toBe(0);
    expect(decision.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(decision.hookSpecificOutput.permissionDecisionReason).toContain('vulcan sync');
  });

  test('a Bash redirect into the manifest is denied', () => {
    const result = runHook({
      payload: wire({ tool: 'Bash', input: `{"command":"echo {} > ${MANIFEST}"}` }),
    });

    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
  });

  test('a harmless command prints nothing and exits 0', () => {
    const result = runHook({
      payload: wire({ tool: 'Bash', input: '{"command":"ls"}' }),
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
  });
});

describe('the shipped settings', () => {
  interface IEntry {
    matcher?: string;
    hooks: { command: string }[];
  }

  const entries = (): IEntry[] => JSON.parse(readFileSync(SETTINGS, 'utf8')).hooks.PreToolUse;

  test('guard-manifest.ts is registered on Write, Edit, MultiEdit, NotebookEdit and Bash', () => {
    const entry = entries().find((item) =>
      item.hooks.some((hook) => hook.command.includes('hooks/guard-manifest.ts')),
    );

    expect(entry?.matcher).toBeDefined();

    for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash']) {
      expect(new RegExp(`^(?:${entry?.matcher})$`).test(tool), tool).toBe(true);
    }
  });
});

const SCRIPT_CASES: { name: string; command: string; blocked: boolean }[] = [
  {
    name: 'bun -e, the file name joined from two strings',
    command: `bun -e "await Bun.write('.agents/vulcan.mani'+'fest.json','{}')"`,
    blocked: true,
  },
  {
    name: 'node -e, the name joined from three strings',
    command: `node -e "require('fs').writeFileSync('.agents/'+'vulcan.'+'manifest.json','{}')"`,
    blocked: true,
  },
  {
    name: 'bun --eval, the path joined from an array',
    command: `bun --eval "Bun.write(['.agents','vulcan.manifest.json'].join('/'),'{}')"`,
    blocked: true,
  },
  {
    name: 'node --eval, an append',
    command: `node --eval "require('fs').appendFileSync('.agents/vulcan.man'+'ifest.json','x')"`,
    blocked: true,
  },
  {
    name: 'python -c, open for writing',
    command: `python3 -c "open('.agents/vulcan.mani'+'fest.json','w').write('{}')"`,
    blocked: true,
  },
  {
    name: 'python -c, a copy onto a joined name',
    command: `python3 -c "import shutil; shutil.copy('/tmp/m.json', '.agents/vulcan.' + 'manifest.json')"`,
    blocked: true,
  },
  {
    name: 'bash -c, a redirect to a name split by empty quotes',
    command: `bash -c 'echo {} > .agents/vulcan.mani""fest.json'`,
    blocked: true,
  },
  {
    name: 'sh -c, a copy onto a name split by quotes',
    command: `sh -c 'cp /tmp/m.json .agents/vulcan.mani"fest.json"'`,
    blocked: true,
  },
  {
    name: 'a shell redirect to a name split by empty quotes, no inline script',
    command: `echo '{}' > .agents/vulcan.mani""fest.json`,
    blocked: true,
  },
  {
    name: 'bun -e run from inside .agents',
    command: `cd .agents && bun -e "await Bun.write('vulcan.mani'+'fest.json','{}')"`,
    blocked: true,
  },
  {
    name: 'a script read from a heredoc',
    command: "bun <<'EOF'\nawait Bun.write('.agents/vulcan.mani'+'fest.json','{}');\nEOF",
    blocked: true,
  },
  {
    name: 'behind env and a variable',
    command: `env NODE_ENV=x bun -e "await Bun.write('.agents/vulcan.mani'+'fest.json','{}')"`,
    blocked: true,
  },
  {
    name: 'upper-case spelling of the name',
    command: `bun -e "await Bun.write('.agents/VULCAN.Manifest.JSON','{}')"`,
    blocked: true,
  },
  {
    name: 'a removal',
    command: `node -e "require('fs').rmSync('.agents/vulcan.manifest.json')"`,
    blocked: true,
  },
  { name: 'bun -e that prints', command: 'bun -e "console.log(1)"', blocked: false },
  { name: 'bun test', command: 'bun test', blocked: false },
  {
    name: 'Bun.write of another file',
    command: `bun -e "await Bun.write('notes.txt','x')"`,
    blocked: false,
  },
  {
    name: 'Bun.write of another file under .agents',
    command: `bun -e "await Bun.write('.agents/local/notes.txt','x')"`,
    blocked: false,
  },
  {
    name: 'bun -e that only reads the manifest',
    command: `bun -e "console.log(await Bun.file('.agents/vulcan.manifest.json').text())"`,
    blocked: false,
  },
  {
    name: 'node -e that only reads the manifest',
    command: `node -e "console.log(require('./.agents/vulcan.manifest.json').schemaVersion)"`,
    blocked: false,
  },
  {
    name: 'python -c that only reads the manifest',
    command: `python3 -c "import json; print(json.load(open('.agents/vulcan.manifest.json')))"`,
    blocked: false,
  },
  {
    name: 'a script that writes elsewhere, then a read of the manifest',
    command: `bun -e "await Bun.write('/tmp/x.json','{}')" && cat .agents/vulcan.manifest.json`,
    blocked: false,
  },
  {
    name: 'bash -c that writes another file',
    command: `bash -c 'echo hi > out.txt'`,
    blocked: false,
  },
  {
    name: 'a script file run by bun',
    command: 'bun run scripts/build.ts',
    blocked: false,
  },
];

const GIT_CASES: { name: string; command: string; blocked: boolean }[] = [
  {
    name: 'checkout of a revision with the file after --',
    command: `git checkout HEAD~1 -- ${MANIFEST}`,
    blocked: true,
  },
  {
    name: 'checkout of a revision, no --',
    command: `git checkout HEAD~1 ${MANIFEST}`,
    blocked: true,
  },
  {
    name: 'checkout of the file from a stash',
    command: `git checkout stash@{0} -- ${MANIFEST}`,
    blocked: true,
  },
  {
    name: 'checkout of the file under -C',
    command: `git -C ${ROOT} checkout abc123 -- .agents/vulcan.mani"fest.json"`,
    blocked: true,
  },
  {
    name: 'checkout of the .agents folder',
    command: 'git checkout HEAD~1 -- .agents',
    blocked: true,
  },
  {
    name: 'restore from a source',
    command: `git restore --source=HEAD~1 -- ${MANIFEST}`,
    blocked: true,
  },
  {
    name: 'restore with -s and both targets',
    command: `git restore -s HEAD~1 --staged --worktree ${MANIFEST}`,
    blocked: true,
  },
  {
    name: 'restore by a pattern that matches the file',
    command: "git restore '.agents/vulcan.*'",
    blocked: true,
  },
  {
    name: 'apply of a patch given as a heredoc',
    command: `git apply <<'EOF'\ndiff --git a/${MANIFEST} b/${MANIFEST}\n--- a/${MANIFEST}\n+++ b/${MANIFEST}\n@@ -1 +1 @@\n-{}\n+{"a":1}\nEOF`,
    blocked: true,
  },
  { name: 'checkout of a branch', command: 'git checkout main', blocked: false },
  { name: 'checkout of another file', command: 'git checkout HEAD~1 -- README.md', blocked: false },
  { name: 'restore of another file', command: 'git restore docs/a.md', blocked: false },
  { name: 'restore of the index only', command: 'git restore --staged .', blocked: false },
  { name: 'diff of the file', command: `git diff HEAD~1 -- ${MANIFEST}`, blocked: false },
  { name: 'show of the file', command: `git show HEAD:${MANIFEST}`, blocked: false },
  {
    name: 'a commit message that names the file',
    command: 'git commit -m "restore vulcan.manifest.json after a checkout"',
    blocked: false,
  },
];

describe('the hook script: inline scripts and git forms', () => {
  for (const item of [...SCRIPT_CASES, ...GIT_CASES]) {
    test(`${item.name}: ${item.blocked ? 'denied' : 'allowed'}`, () => {
      expect(answerToCommand({ command: item.command, cwd: ROOT })).toBe(
        item.blocked ? 'deny' : undefined,
      );
    });
  }

  test('a denied script command carries the usual message', () => {
    const result = runHook({
      payload: wire({
        tool: 'Bash',
        input: JSON.stringify({
          command: `bun -e "await Bun.write('.agents/vulcan.mani'+'fest.json','{}')"`,
        }),
        cwd: ROOT,
      }),
    });

    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason).toBe(
      'vulcan.manifest.json is generated - edit .configs/vulcan.config.* and run `vulcan sync`',
    );
  });
});

describe('the hook script: a patch or a stash that holds the manifest', () => {
  const repoWithManifest = (): string => {
    const root = createProject({
      files: { [MANIFEST]: '{}\n', 'README.md': 'a\n', 'docs/a.md': 'a\n' },
    });

    initRepo({ cwd: root });

    return root;
  };

  test('git apply of a patch file that changes the manifest is denied', () => {
    const root = repoWithManifest();

    writeFileSync(join(root, MANIFEST), '{"a":1}\n');
    writeFileSync(join(root, 'fix.patch'), `${git({ cwd: root, args: ['diff'] })}\n`);
    git({ cwd: root, args: ['checkout', '--', MANIFEST] });

    expect(answerToCommand({ command: 'git apply fix.patch', cwd: root })).toBe('deny');
    expect(answerToCommand({ command: 'git am fix.patch', cwd: root })).toBe('deny');
    expect(answerToCommand({ command: 'git apply < fix.patch', cwd: root })).toBe('deny');
  });

  test('git apply of a patch file that changes something else is allowed', () => {
    const root = repoWithManifest();

    writeFileSync(join(root, 'README.md'), 'b\n');
    writeFileSync(join(root, 'other.patch'), `${git({ cwd: root, args: ['diff'] })}\n`);
    git({ cwd: root, args: ['checkout', '--', 'README.md'] });

    expect(answerToCommand({ command: 'git apply other.patch', cwd: root })).toBeUndefined();
    expect(
      answerToCommand({ command: 'git apply --check other.patch', cwd: root }),
    ).toBeUndefined();
  });

  test('git stash pop and apply are denied when the stash holds the manifest', () => {
    const root = repoWithManifest();

    writeFileSync(join(root, MANIFEST), '{"a":1}\n');
    git({ cwd: root, args: ['stash'] });

    expect(answerToCommand({ command: 'git stash pop', cwd: root })).toBe('deny');
    expect(answerToCommand({ command: 'git stash apply stash@{0}', cwd: root })).toBe('deny');
    expect(answerToCommand({ command: `git -C ${root} stash pop`, cwd: '/tmp' })).toBe('deny');
  });

  test('git stash pop is allowed when the stash holds other files', () => {
    const root = repoWithManifest();

    writeFileSync(join(root, 'README.md'), 'b\n');
    git({ cwd: root, args: ['stash'] });

    expect(answerToCommand({ command: 'git stash pop', cwd: root })).toBeUndefined();
    expect(answerToCommand({ command: 'git stash list', cwd: root })).toBeUndefined();
  });

  test('git stash pop with no stash is allowed', () => {
    expect(answerToCommand({ command: 'git stash pop', cwd: repoWithManifest() })).toBeUndefined();
  });
});

describe('the hook script: a path that is a link to the manifest', () => {
  const projectWithLinks = (): string => {
    const root = createProject({
      files: { [MANIFEST]: '{}\n', '.agents/rules.md': 'r\n', 'notes.txt': 'n\n' },
    });

    symlinkSync(join(root, MANIFEST), join(root, 'to-manifest.json'));
    symlinkSync(join(root, 'to-manifest.json'), join(root, 'second-hop.json'));
    symlinkSync('.agents/vulcan.manifest.json', join(root, 'relative-link.json'));
    symlinkSync(join(root, '.agents'), join(root, 'agents-link'));
    symlinkSync(join(root, '.agents/rules.md'), join(root, 'to-rules.md'));
    symlinkSync(join(root, '.agents/not-yet.json'), join(root, 'to-missing.json'));
    symlinkSync(join(root, 'loop-b'), join(root, 'loop-a'));
    symlinkSync(join(root, 'loop-a'), join(root, 'loop-b'));
    symlinkSync(
      join(root, '.agents/vulcan.manifest.json'),
      join(root, '.agents/created-later-link.json'),
    );

    return root;
  };

  const FILE_TOOLS: { tool: string; key: string }[] = [
    { tool: 'Write', key: FILE_KEY },
    { tool: 'Edit', key: FILE_KEY },
    { tool: 'MultiEdit', key: FILE_KEY },
    { tool: 'NotebookEdit', key: 'notebook_path' },
  ];

  for (const { tool, key } of FILE_TOOLS) {
    test(`${tool} on a link to the manifest is denied, whichever way the link is spelled`, () => {
      const root = projectWithLinks();

      for (const path of [
        join(root, 'to-manifest.json'),
        'to-manifest.json',
        'second-hop.json',
        'relative-link.json',
        'agents-link/vulcan.manifest.json',
        '.agents/created-later-link.json',
      ]) {
        expect(answerOf({ tool, input: { [key]: path }, cwd: root }), path).toBe('deny');
      }
    });
  }

  test('a link whose target is missing, in a folder that is a link to .agents, is denied', () => {
    const root = createProject({ files: { '.agents/rules.md': 'r\n' } });

    symlinkSync(join(root, '.agents'), join(root, 'agents-link'));
    symlinkSync(join(root, '.agents/vulcan.manifest.json'), join(root, 'dangling.json'));

    expect(
      answerOf({
        tool: 'Write',
        input: { [FILE_KEY]: 'agents-link/vulcan.manifest.json' },
        cwd: root,
      }),
    ).toBe('deny');
    expect(answerOf({ tool: 'Write', input: { [FILE_KEY]: 'dangling.json' }, cwd: root })).toBe(
      'deny',
    );
  });

  test('a link to another file, a plain file and a loop are allowed', () => {
    const root = projectWithLinks();

    for (const path of [
      'to-rules.md',
      'notes.txt',
      'to-missing.json',
      'agents-link/rules.md',
      'loop-a',
    ]) {
      expect(
        answerOf({ tool: 'Write', input: { [FILE_KEY]: path }, cwd: root }),
        path,
      ).toBeUndefined();
    }
  });

  test('a shell redirect, tee, cp and mv onto a link to the manifest are denied', () => {
    const root = projectWithLinks();

    for (const command of [
      "echo '{}' > to-manifest.json",
      "echo '{}' >> second-hop.json",
      'cat x | tee relative-link.json',
      'cp /tmp/m.json to-manifest.json',
      'mv /tmp/m.json to-manifest.json',
    ]) {
      expect(answerToCommand({ command, cwd: root }), command).toBe('deny');
    }
  });

  test('a shell write onto a link to another file, and a read through a link, are allowed', () => {
    const root = projectWithLinks();

    for (const command of [
      'echo x > to-rules.md',
      'cat to-manifest.json',
      'cp to-manifest.json /tmp/backup.json',
      'jq . to-manifest.json > out.json',
    ]) {
      expect(answerToCommand({ command, cwd: root }), command).toBeUndefined();
    }
  });
});
