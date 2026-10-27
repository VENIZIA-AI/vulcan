import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { AtlasConstants } from '@/common';
import { buildIndexPair, generateKeyPair, verifyPair } from '@/prebuilt';
import { lsRemote } from '@/sources/git';
import { resolveSources } from '@/sources';
import { spawnSyncBounded } from '../spawn.helper';
import { rowsOf } from './pair.helper';
import {
  commitAll,
  git,
  makeSourceRepository,
  makeTempDirectory,
  NO_REGISTRY,
  TEMP_DIRECTORIES,
  writeSourceFile,
} from '../sources/source-repo.helper';

afterAll(() => {
  for (const directory of TEMP_DIRECTORIES) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const PACKAGE_ROOT = join(__dirname, '..', '..', '..');

const pair = generateKeyPair();

/** A checkout of the source repository, with a place to write the pair inside it. */
const checkout = (): { work: string; out: string; bare: string; url: string } => {
  const source = makeSourceRepository();

  return { ...source, out: join(source.work, '.agents/local/tmp/pair') };
};

const files = (opts: { out: string }): string[] =>
  existsSync(opts.out) ? readdirSync(opts.out) : [];

describe('atlas index: build and sign the index of HEAD (C5)', () => {
  test('a checkout with history gives a pair for HEAD that verifies and says what it holds', () => {
    const { work, out, url } = checkout();
    const sha = git({ cwd: work, args: ['rev-parse', 'HEAD'] });
    const built = buildIndexPair({
      root: work,
      out,
      repo: 'Acme/Src',
      privateKey: pair.privateKey,
      atlasVersion: '9.9.9',
    });

    expect(built.sha).toBe(sha);
    expect(files({ out }).sort()).toEqual([`${sha}.atlas.gz`, `${sha}.atlas.json`]);

    const gz = readFileSync(join(out, `${sha}.atlas.gz`));
    const checked = verifyPair({
      envelope: readFileSync(join(out, `${sha}.atlas.json`), 'utf8'),
      gz,
      keys: [pair.publicKey],
    });

    expect(checked.ok).toBe(true);

    if (!checked.ok) {
      return;
    }

    expect(checked.payload).toMatchObject({
      format: AtlasConstants.INDEX_FORMAT,
      sha,
      repo: 'acme/src',
      atlas: '9.9.9',
      bytes: gunzipSync(gz).length,
      history: true,
    });
    expect(checked.payload.releases.releases.kernel?.[0]?.version).toBe('1.0.0');
    // The fingerprint a reader computes from the remote's tags is the one signed here.
    expect(checked.payload.tags).toBe(lsRemote({ url, ref: 'develop' }).tags ?? '');
  });

  test('a shallow clone gives a pair as well', () => {
    const { bare } = checkout();
    const shallow = join(makeTempDirectory({ prefix: 'atlas-shallow-' }), 'work');

    git({
      cwd: makeTempDirectory({ prefix: 'atlas-shallow-cwd-' }),
      args: ['clone', '-q', '--depth', '1', `file://${bare}`, shallow],
    });

    const built = buildIndexPair({
      root: shallow,
      out: join(shallow, '.agents/local/tmp/pair'),
      repo: 'acme/src',
      privateKey: pair.privateKey,
      atlasVersion: '9.9.9',
    });

    expect(files({ out: join(shallow, '.agents/local/tmp/pair') })).toContain(
      `${built.sha}.atlas.gz`,
    );
  });

  test('no commit, no key and an output outside the project are refused, and nothing is written', () => {
    const { work, out } = checkout();
    const empty = makeTempDirectory({ prefix: 'atlas-nocommit-' });

    git({ cwd: empty, args: ['init', '-q', '-b', 'develop'] });
    expect(() =>
      buildIndexPair({
        root: empty,
        out: join(empty, 'pair'),
        repo: 'a/b',
        privateKey: pair.privateKey,
        atlasVersion: '1',
      }),
    ).toThrow('no commit');
    expect(() =>
      buildIndexPair({ root: work, out, repo: 'a/b', privateKey: undefined, atlasVersion: '1' }),
    ).toThrow('ATLAS_INDEX_KEY');
    expect(() =>
      buildIndexPair({
        root: work,
        out: join(makeTempDirectory({ prefix: 'atlas-outside-' }), 'pair'),
        repo: 'a/b',
        privateKey: pair.privateKey,
        atlasVersion: '1',
      }),
    ).toThrow('inside the project');
    expect(files({ out })).toEqual([]);
  });

  test('the worktree it builds from is gone afterwards', () => {
    const { work, out } = checkout();

    buildIndexPair({
      root: work,
      out,
      repo: 'acme/src',
      privateKey: pair.privateKey,
      atlasVersion: '1',
    });
    expect(git({ cwd: work, args: ['worktree', 'list'] }).split('\n')).toHaveLength(1);
  });

  test('the command runs from the command line, reading the key from the environment', () => {
    const { work, out } = checkout();
    const run = (opts: { env: Record<string, string> }) =>
      spawnSyncBounded({
        cmd: [
          process.execPath,
          join(PACKAGE_ROOT, 'src/cli.ts'),
          'index',
          '--out',
          out,
          '--repo',
          'acme/src',
        ],
        cwd: work,
        env: { ...process.env, VULCAN_NPM_REGISTRY: NO_REGISTRY, ATLAS_INDEX_KEY: '', ...opts.env },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      });

    const refused = run({ env: {} });

    expect(refused.exitCode).not.toBe(0);
    expect(refused.stderr.toString()).toContain('ATLAS_INDEX_KEY');
    expect(files({ out })).toEqual([]);

    const done = run({ env: { ATLAS_INDEX_KEY: pair.privateKey } });
    const sha = git({ cwd: work, args: ['rev-parse', 'HEAD'] });

    expect(done.exitCode).toBe(0);
    expect(files({ out }).sort()).toEqual([`${sha}.atlas.gz`, `${sha}.atlas.json`]);
    expect(done.stdout.toString()).not.toContain(pair.privateKey);
  });
});

describe('atlas index: only the tracked files of the commit go in (C6)', () => {
  test('an untracked and an ignored markdown file in a declared root stay out', () => {
    const { work, out } = checkout();

    writeSourceFile({
      work,
      path: '.gitignore',
      text: '.agents/knowledge/overview/ignored-note.md\n.agents/local/\n',
    });
    commitAll({ work, message: 'chore: ignore a note' });
    writeSourceFile({
      work,
      path: '.agents/knowledge/overview/untracked-note.md',
      text: '---\ntype: Concept\ntitle: Untracked\ndescription: Not committed.\n---\n\nThe untracked secret phrase.\n',
    });
    writeSourceFile({
      work,
      path: '.agents/knowledge/overview/ignored-note.md',
      text: '---\ntype: Concept\ntitle: Ignored\ndescription: Ignored.\n---\n\nThe ignored secret phrase.\n',
    });

    const built = buildIndexPair({
      root: work,
      out,
      repo: 'acme/src',
      privateKey: pair.privateKey,
      atlasVersion: '1',
    });
    const rows = rowsOf({ bytes: gunzipSync(readFileSync(join(out, `${built.sha}.atlas.gz`))) });
    const text = JSON.stringify(rows);

    expect(text).toContain('kernel.md');
    expect(text).not.toContain('untracked');
    expect(text).not.toContain('ignored-note');
    expect(text).not.toContain('secret phrase');
  });

  test('a tracked file changed in the working tree is indexed as committed', () => {
    const { work, out } = checkout();

    writeFileSync(
      join(work, '.agents/knowledge/overview/kernel.md'),
      '---\ntype: Concept\ntitle: Kernel\ndescription: The kernel.\n---\n\nAn edit that was never committed.\n',
    );

    const built = buildIndexPair({
      root: work,
      out,
      repo: 'acme/src',
      privateKey: pair.privateKey,
      atlasVersion: '1',
    });
    const text = JSON.stringify(
      rowsOf({ bytes: gunzipSync(readFileSync(join(out, `${built.sha}.atlas.gz`))) }),
    );

    expect(text).toContain('The kernel boots the application.');
    expect(text).not.toContain('never committed');
  });
});

describe('atlas index equals what pull builds (C7)', () => {
  test('the same commit gives the same rows, in the same order', async () => {
    const { work, out, url } = checkout();
    const built = buildIndexPair({
      root: work,
      out,
      repo: 'acme/src',
      privateKey: pair.privateKey,
      atlasVersion: '1',
    });

    process.env.VULCAN_NPM_REGISTRY = NO_REGISTRY;

    const cacheDir = makeTempDirectory({ prefix: 'atlas-cache-' });
    const [pulled] = await resolveSources({
      cwd: makeTempDirectory({ prefix: 'atlas-consumer-' }),
      cacheDir,
      sources: [{ name: 'src', repo: url, ref: 'develop' }],
    });

    delete process.env.VULCAN_NPM_REGISTRY;
    expect(pulled.sha).toBe(built.sha);

    const fromPull = rowsOf({ bytes: readFileSync(pulled.indexFile ?? '') });
    const fromBuild = rowsOf({
      bytes: gunzipSync(readFileSync(join(out, `${built.sha}.atlas.gz`))),
    });

    expect(fromPull.length).toBeGreaterThan(1);
    expect(fromBuild).toEqual(fromPull);
  });
});
