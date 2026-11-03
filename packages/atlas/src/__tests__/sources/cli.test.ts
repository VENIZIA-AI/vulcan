import { afterAll, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { SourceArguments } from '@/cli/sources';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';
import {
  git,
  makeSourceRepository,
  makeTempDirectory,
  NO_REGISTRY,
  TEMP_DIRECTORIES,
  writeSourceFile,
} from './source-repo.helper';

afterAll(() => {
  for (const directory of TEMP_DIRECTORIES) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const PACKAGE_ROOT = join(__dirname, '..', '..', '..');

describe('--source', () => {
  test('owner/repo@ref, owner/repo (develop) and a git URL@ref', () => {
    expect(SourceArguments.parse({ value: 'VENIZIA-AI/ignis@main' })).toEqual({
      name: 'ignis',
      repo: 'VENIZIA-AI/ignis',
      ref: 'main',
    });
    expect(SourceArguments.parse({ value: 'VENIZIA-AI/ardor' })).toEqual({
      name: 'ardor',
      repo: 'VENIZIA-AI/ardor',
      ref: 'develop',
    });
    expect(SourceArguments.parse({ value: 'file:///tmp/x/src.git@develop' })).toEqual({
      name: 'src',
      repo: 'file:///tmp/x/src.git',
      ref: 'develop',
    });
  });

  test('--source repeats, in both spellings', () => {
    expect(
      SourceArguments.read({ argv: ['mcp', '--source', 'a/one', '--source=b/two@main'] }).map(
        (source) => source.name,
      ),
    ).toEqual(['one', 'two']);
  });
});

describe('vulcan-atlas over git sources', () => {
  const run = (opts: { args: string[]; cwd: string; cache: string; input?: string }) => {
    const result = spawnSyncBounded({
      cmd: [
        process.execPath,
        join(PACKAGE_ROOT, 'src/cli.ts'),
        ...opts.args,
        '--cache-dir',
        opts.cache,
      ],
      cwd: opts.cwd,
      env: { ...process.env, VULCAN_NPM_REGISTRY: NO_REGISTRY },
      stdin: opts.input === undefined ? 'ignore' : Buffer.from(opts.input),
      stdout: 'pipe',
      stderr: 'pipe',
    });

    return {
      code: result.exitCode,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    };
  };

  test('--cache-dir with no value is a usage error: exit 2, nothing on stdout', () => {
    const result = spawnSyncBounded({
      cmd: [process.execPath, join(PACKAGE_ROOT, 'src/cli.ts'), 'mcp', '--cache-dir'],
      cwd: makeTempDirectory({ prefix: 'atlas-nocache-' }),
      env: { ...process.env, VULCAN_NPM_REGISTRY: NO_REGISTRY },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain('--cache-dir requires a value');
    expect(result.stdout.toString()).toBe('');
  });

  test('mcp --source serves it from an empty directory: initialize names it as indexing, every hit names it', () => {
    const source = makeSourceRepository();
    const requests = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'search', arguments: { query: 'kernel boots' } },
      },
    ];
    const result = run({
      args: ['mcp', '--source', `${source.url}@develop`],
      cwd: makeTempDirectory({ prefix: 'atlas-empty-' }),
      cache: makeTempDirectory({ prefix: 'atlas-cache-' }),
      input: `${requests.map((request) => JSON.stringify(request)).join('\n')}\n`,
    });
    const replies = result.stdout
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line))
      // Replies may come in any order: a call that waits for the source does not hold back the ones after it.
      .sort((left, right) => left.id - right.id);

    expect(result.stderr).not.toContain('Error');
    // The first answer comes before the source is indexed; a call waits for it (the status lines after it are covered in boot.test.ts).
    expect(replies[0].result.instructions).toContain(`- source: INDEXING (${source.url}@develop)`);
    expect(JSON.parse(replies[1].result.content[0].text).hits[0].source).toBe('source');
  });

  test('mcp --source=<repo>@<ref> (the joined spelling) reaches the indexing child too', () => {
    const source = makeSourceRepository();
    const requests = [
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'search', arguments: { query: 'kernel boots' } },
      },
    ];
    const result = run({
      args: ['mcp', `--source=${source.url}@develop`],
      cwd: makeTempDirectory({ prefix: 'atlas-empty-' }),
      cache: makeTempDirectory({ prefix: 'atlas-cache-' }),
      input: `${requests.map((request) => JSON.stringify(request)).join('\n')}\n`,
    });
    const replies = result.stdout
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));

    expect(JSON.parse(replies[0].result.content[0].text).hits[0].source).toBe('source');
  });

  test('pull fetches again and says what it got', () => {
    const source = makeSourceRepository();
    const cache = makeTempDirectory({ prefix: 'atlas-cache-' });
    const cwd = makeTempDirectory({ prefix: 'atlas-empty-' });
    const sha = git({ cwd: source.work, args: ['rev-parse', 'HEAD'] }).slice(0, 8);

    expect(run({ args: ['pull', '--source', `${source.url}@develop`], cwd, cache }).stdout).toBe(
      `pull: source ${sha} (fresh)\n`,
    );
    expect(run({ args: ['pull', '--source', `${source.url}@develop`], cwd, cache }).stdout).toBe(
      `pull: source ${sha} (fresh)\n`,
    );
  });

  test('pull --source with a name no source has exits 2, naming the known sources', () => {
    const source = makeSourceRepository();
    const cache = makeTempDirectory({ prefix: 'atlas-cache-' });
    const cwd = makeTempDirectory({ prefix: 'atlas-consumer-' });

    writeSourceFile({
      work: cwd,
      path: '.agents/vulcan.manifest.json',
      text: `${JSON.stringify({
        schemaVersion: 1,
        name: 'consumer',
        sources: [
          { name: 'src', repo: source.url, ref: 'develop' },
          { name: 'other', repo: source.url, ref: 'main' },
        ],
      })}\n`,
    });

    const result = run({ args: ['pull', '--source', 'nope'], cwd, cache });

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("pull: no source named 'nope' - known sources: src, other");
    expect(result.stdout).toBe('');
  });
});
