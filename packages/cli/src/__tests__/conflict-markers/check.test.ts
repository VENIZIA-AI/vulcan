import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';
import { ConflictMarkers } from '../../conflict-markers/index.ts';
import { git, initRepo } from '../helpers/git-repo.helper.ts';
import { createProject, removeProjects } from '../helpers/project.helper.ts';

afterAll(removeProjects);

// Built from parts, so this file holds no marker of its own.
const OURS = `${'<'.repeat(7)} HEAD`;
const BASE = `${'|'.repeat(7)} 29fd7036`;
const MIDDLE = '='.repeat(7);
const THEIRS = `${'>'.repeat(7)} origin/develop`;

const repository = (files: Record<string, string>): string => {
  const root = createProject({ files });

  initRepo({ cwd: root });

  return root;
};

const run = (root: string, args: string[] = []): { code: number; output: string } => {
  const lines: string[] = [];
  const code = ConflictMarkers.run({ root, args, write: (text) => lines.push(text) });

  return { code, output: lines.join('') };
};

describe('the conflict marker gate', () => {
  test('each of the four markers in a tracked file fails, named by file and line, docs included', () => {
    const root = repository({
      'docs/log.md': ['# Log', OURS, 'a', BASE, MIDDLE, 'b', THEIRS, ''].join('\n'),
      'src/a.ts': `${OURS}\r\n`,
    });
    const { code, output } = run(root);

    expect(code).toBe(1);

    for (const found of ['docs/log.md:2:', 'docs/log.md:4:', 'docs/log.md:5:', 'docs/log.md:7:']) {
      expect(output).toContain(found);
    }

    expect(output).toContain('src/a.ts:1:');
  });

  test('a lone base marker left by a merge fails on its own', () => {
    expect(run(repository({ 'a.md': `- one\n${BASE}\n- two\n` })).code).toBe(1);
  });

  test('longer rules, indented text and markers inside a line pass', () => {
    const root = repository({
      'a.md': [`Title`, '='.repeat(12), `  ${OURS}`, `see ${THEIRS}`, `${MIDDLE} no`, ''].join(
        '\n',
      ),
      'b.sh': `cat ${'<'.repeat(7)}x\n`,
    });

    expect(run(root)).toEqual({ code: 0, output: '' });
  });

  test('untracked files, binary files and links are not read', () => {
    const root = repository({ 'bin.dat': `\0\n${OURS}\n`, 'ok.md': 'fine\n' });

    writeFileSync(join(root, 'new.md'), `${OURS}\n`);
    symlinkSync('new.md', join(root, 'link.md'));
    git({ cwd: root, args: ['add', 'link.md'] });

    expect(run(root).code).toBe(0);
  });

  test('--skip leaves a path out; another argument or a folder git cannot list exits 2', () => {
    const root = repository({ 'fixtures/conflict.txt': `${OURS}\n` });

    expect(run(root).code).toBe(1);
    expect(run(root, ['--skip', 'fixtures/']).code).toBe(0);
    expect(run(root, ['--skip']).code).toBe(2);
    expect(run(root, ['--nope']).code).toBe(2);

    const bare = createProject({ files: {} });

    mkdirSync(join(bare, '.git'));
    expect(run(bare).code).toBe(2);
  });

  test('the shipped script runs it in the folder it is started in', () => {
    const root = repository({ 'a.md': `${THEIRS}\n` });
    const script = join(import.meta.dir, '..', '..', '..', 'base', 'checks', 'conflict-markers.ts');
    const child = spawnSyncBounded({
      cmd: [process.execPath, script],
      cwd: root,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    expect(child.exitCode).toBe(1);
    expect(child.stderr.toString()).toContain('a.md:1:');
  });
});
