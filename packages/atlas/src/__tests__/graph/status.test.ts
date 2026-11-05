import { afterAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { atlas, git, removeRepositories, repository } from './graph.helper';

afterAll(removeRepositories);

const status = (opts: { root: string; env?: Record<string, string> }) => {
  const result = atlas({ root: opts.root, args: ['graph', 'status', '--json'], env: opts.env });

  expect(result.exitCode, result.stderr.toString()).toBe(0);

  return JSON.parse(result.stdout.toString());
};
const text = (opts: { root: string }): string =>
  atlas({ root: opts.root, args: ['graph', 'status'] }).stdout.toString();
const build = (opts: { root: string }): void => {
  expect(atlas({ root: opts.root, args: ['graph', 'build'] }).exitCode).toBe(0);
};
const commit = (opts: { root: string; message: string }): void => {
  git({ root: opts.root, args: ['add', '-A'] });
  git({ root: opts.root, args: ['commit', '-q', '--allow-empty', '-m', opts.message] });
};

describe('vulcan x atlas graph status', () => {
  test('unknown before a graph is built, and it says what to run', () => {
    const root = repository();

    expect(status({ root })).toMatchObject({ state: 'unknown' });
    expect(text({ root })).toContain(
      'unknown - no graph has been built here: run vulcan x atlas graph build',
    );
  });

  test('fresh right after a build, and after a commit that changed nothing the graph reads', () => {
    const root = repository();

    build({ root });

    expect(status({ root })).toMatchObject({ state: 'fresh' });

    commit({ root, message: 'empty' });
    writeFileSync(join(root, 'README.md'), 'not code\n');
    commit({ root, message: 'docs' });

    const after = status({ root });

    expect(after.state).toBe('fresh');
    expect(after.commit).not.toBe(after.head);
    expect(text({ root })).toContain('fresh - nothing it was built from has changed');
  });

  test('behind n: files changed, new or gone since the build, the first five named', () => {
    const root = repository();

    build({ root });
    writeFileSync(join(root, 'packages/a/src/util.ts'), 'export const util = 9;\n');
    writeFileSync(join(root, 'packages/a/src/extra.ts'), 'export const extra = 1;\n');
    git({ root, args: ['add', 'packages/a/src/extra.ts'] });

    const result = status({ root });

    expect(result).toMatchObject({ state: 'behind', behind: 2 });
    expect(result.files).toEqual(['packages/a/src/extra.ts', 'packages/a/src/util.ts']);
    expect(text({ root })).toContain(
      'behind 2 - packages/a/src/extra.ts, packages/a/src/util.ts changed since it was built',
    );
  });

  test('behind names only five files and counts the rest', () => {
    const root = repository();

    build({ root });

    for (const index of [1, 2, 3, 4, 5, 6, 7]) {
      writeFileSync(join(root, `packages/a/src/n${index}.ts`), `export const n${index} = 1;\n`);
    }

    git({ root, args: ['add', '-A'] });

    const result = status({ root });

    expect(result.behind).toBe(7);
    expect(result.files).toHaveLength(5);
    expect(text({ root })).toContain('and 2 more');
  });

  test('a new file git does not track yet is not part of the graph, so it does not make it behind', () => {
    const root = repository();

    build({ root });
    writeFileSync(join(root, 'packages/a/src/untracked.ts'), 'export const u = 1;\n');

    expect(status({ root }).state).toBe('fresh');
  });

  test('a change to a file the graph does not read, or an uncommitted edit that is undone, leaves it fresh', () => {
    const root = repository();

    build({ root });
    writeFileSync(join(root, 'packages/a/README.md'), 'notes\n');
    writeFileSync(join(root, 'packages/a/src/util.ts'), 'export const util = 2;\n');
    writeFileSync(join(root, 'packages/a/src/util.ts'), 'export const util = 1;\n');

    expect(status({ root }).state).toBe('fresh');
  });

  test('diverged: the build commit is not in this history and files differ', () => {
    const root = repository();

    writeFileSync(join(root, 'packages/a/src/util.ts'), 'export const util = 3;\n');
    commit({ root, message: 'change util' });
    build({ root });
    git({ root, args: ['checkout', '-q', '-b', 'older', 'HEAD~1'] });

    const result = status({ root });

    expect(result).toMatchObject({ state: 'diverged', behind: 1 });
    expect(text({ root })).toContain('diverged - built at');
    expect(text({ root })).toContain("which is not in this branch's history");
  });

  test('unknown when git cannot be asked, never an error', () => {
    const root = repository();

    build({ root });

    const result = status({ root, env: { GIT_DIR: join(root, 'no-repository') } });

    expect(result.state).toBe('unknown');
    expect(result.reason).toContain('git cannot be asked');
  });

  test('refuses an argument it does not know', () => {
    const root = repository();

    expect(atlas({ root, args: ['graph', 'status', '--nope'] }).exitCode).toBe(2);
  });

  test('behind when only the built declarations of a package changed', () => {
    const root = repository();

    build({ root });
    mkdirSync(join(root, 'packages/b/dist'), { recursive: true });
    writeFileSync(join(root, 'packages/b/dist/index.d.ts'), 'export declare const b: 1;\n');

    const rebuilt = status({ root });

    expect(rebuilt).toMatchObject({ state: 'behind', behind: 1 });
    expect(rebuilt.files).toEqual(['@fx/b (built declarations)']);
  });

  test('behind, not diverged, when git cannot say whether the build commit is in this history (a commit it does not have)', () => {
    const root = repository();

    build({ root });

    const meta = JSON.parse(readFileSync(join(root, '.agents/local/graph/meta.json'), 'utf8'));

    writeFileSync(
      join(root, '.agents/local/graph/meta.json'),
      JSON.stringify({ ...meta, commit: 'deadbeefdead' }),
    );
    writeFileSync(join(root, 'packages/a/src/util.ts'), 'export const util = 4;\n');

    expect(status({ root }).state).toBe('behind');
  });

  test('a repository with no commit yet still answers', () => {
    const root = repository();

    git({ root, args: ['update-ref', '-d', 'HEAD'] });
    build({ root });

    expect(status({ root }).state).toBe('fresh');
  });
});
