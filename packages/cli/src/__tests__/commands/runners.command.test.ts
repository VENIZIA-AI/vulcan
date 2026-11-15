import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';
import { RunnersCheck } from '../../runners/check.ts';

afterAll(removeProjects);

/** A git repository holding `files`, all tracked, plus `untracked` files git does not know. */
const repository = (opts: {
  files: Record<string, string>;
  untracked?: Record<string, string>;
}): string => {
  const root = createProject({ files: opts.files });

  for (const args of [
    ['init', '-q', '-b', 'main'],
    ['config', 'user.email', 't@t.t'],
    ['config', 'user.name', 't'],
    ['add', '-A'],
    ['commit', '-q', '-m', 'base'],
  ]) {
    spawnSync('git', args, { cwd: root });
  }

  for (const [path, text] of Object.entries(opts.untracked ?? {})) {
    const file = createProject({ files: { [path]: text } });

    spawnSync('cp', ['-r', `${file}/.`, root]);
  }

  return root;
};

const findings = (opts: { root: string }): string[] =>
  RunnersCheck.scan({ root: opts.root }).findings.map(
    (finding) => `${finding.file}:${finding.line}: ${finding.name}`,
  );

describe('RunnersCheck.scan', () => {
  test('names the file, the line and the package of every command that runs an unscoped name', () => {
    const root = repository({
      files: {
        'README.md':
          '# App\n\nRun `bun x --no-install ardor codemod` first.\n\n```sh\nbunx devz lint\n```\n',
        Makefile: 'lint:\n\t@npx ignis-build-info\n',
        '.github/workflows/ci.yml': 'jobs:\n  a:\n    steps:\n      - run: pnpm dlx vulcan sync\n',
        'package.json': '{ "scripts": { "x": "bun x vulcan x okf check" } }\n',
      },
    });

    expect(findings({ root }).sort()).toEqual([
      '.github/workflows/ci.yml:4: vulcan',
      'Makefile:2: ignis-build-info',
      'README.md:3: ardor',
      'README.md:6: devz',
      'package.json:1: vulcan',
    ]);
  });

  test('passes scoped @venizia packages, and the names the manifest allows', () => {
    const root = repository({
      files: {
        '.agents/vulcan.manifest.json': JSON.stringify({
          schemaVersion: 1,
          guard: { runners: { allow: ['shadcn'] } },
        }),
        'README.md':
          'bun x @venizia/vulcan@0.4.10 init\nbunx shadcn@latest add button\nbun run vulcan sync\nnode_modules/.bin/ardor codemod\n',
      },
    });

    expect(findings({ root })).toEqual([]);
  });

  test('skips what is not an instruction: tests, lockfiles, dist, binaries, untracked files and frozen history', () => {
    const root = repository({
      files: {
        'src/__tests__/a.test.ts': "run('bunx ardor')\n",
        'src/a.test.ts': "run('npx ardor')\n",
        'bun.lock': 'bunx ardor\n',
        'dist/index.js': 'bunx ardor\n',
        'docs/changelogs/2026-11-01-old.md': 'Run `bunx ardor`.\n',
        'docs/changelogs/0.4.1/log.md':
          '---\nversion: 0.4.1\nreleased: 2026-11-01\n---\nRun `bunx ardor`.\n',
        'docs/changelogs/0.4.1/migration.yaml': 'x:\n  steps:\n    - bunx ardor\n',
        'README.md': 'nothing here\n',
      },
      untracked: { 'notes.md': 'bunx ardor\n' },
    });

    expect(findings({ root })).toEqual([]);
  });

  test('reads the log of a version folder in progress', () => {
    const root = repository({
      files: {
        'docs/changelogs/0.4.2/log.md': '---\nversion: 0.4.2\n---\nRun `bunx ardor`.\n',
      },
    });

    expect(findings({ root })).toEqual(['docs/changelogs/0.4.2/log.md:4: ardor']);
  });

  test('a folder git cannot list is an error, not a clean pass', () => {
    expect(() => RunnersCheck.scan({ root: join(repository({ files: {} }), 'missing') })).toThrow();
  });
});

describe('vulcan runners check', () => {
  test('exits 1 and prints file:line, the command and the safe forms; exits 0 when clean', () => {
    const dirty = repository({ files: { 'README.md': 'Run bun x ardor now\n\n    bunx ardor\n' } });
    const result = runCli({ args: ['runners', 'check'], cwd: dirty });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('README.md:3');
    expect(result.stderr).toContain('bun run');

    const clean = repository({ files: { 'README.md': 'bun run ardor\n' } });

    expect(runCli({ args: ['runners', 'check'], cwd: clean }).code).toBe(0);
  });

  test('anything but check is a usage error', () => {
    expect(runCli({ args: ['runners'], cwd: repository({ files: {} }) }).code).toBe(2);
    expect(runCli({ args: ['runners', 'fix'], cwd: repository({ files: {} }) }).code).toBe(2);
  });
});
