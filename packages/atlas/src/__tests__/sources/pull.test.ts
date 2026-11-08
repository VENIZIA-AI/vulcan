import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { SourcesServer } from '@/server/index';
import { SourceCache, SourceResolver } from '@/sources';
import {
  commitAll,
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

let cacheDir: string;

beforeEach(() => {
  cacheDir = makeTempDirectory({ prefix: 'atlas-cache-' });
  process.env.VULCAN_NPM_REGISTRY = NO_REGISTRY;
});

afterEach(() => {
  delete process.env.VULCAN_NPM_REGISTRY;
});

const SOURCES_MODULE = join(__dirname, '../../sources/index.ts');

/** One cold start in its own process - what three MCP clients starting at once amount to. */
const startInProcess = async (opts: { url: string; cwd: string; cacheDir: string }) => {
  const script = [
    `const { SourceResolver } = require(${JSON.stringify(SOURCES_MODULE)});`,
    `SourceResolver.resolve({ cwd: ${JSON.stringify(opts.cwd)}, cacheDir: ${JSON.stringify(opts.cacheDir)}, sources: [{ name: 'src', repo: ${JSON.stringify(opts.url)}, ref: 'develop' }] })`,
    '  .then(([resolved]) => console.log(JSON.stringify({ sha: resolved.sha })))',
    '  .catch(error => { console.error(String(error)); process.exit(1); });',
  ].join('\n');
  const child = Bun.spawn({
    cmd: [process.execPath, '-e', script],
    cwd: opts.cwd,
    env: { ...process.env },
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 60_000,
    killSignal: 'SIGKILL',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() };
};

const searchFor = async (opts: {
  resolved: Awaited<ReturnType<typeof SourceResolver.resolve>>;
  query: string;
}) => {
  const server = SourcesServer.build({
    sources: opts.resolved,
    cwd: opts.resolved[0].root,
    version: '0.0.0',
  });

  const result = await server.handleLine({
    line: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'search', arguments: { query: opts.query } },
    }),
  });
  return JSON.stringify(JSON.parse(result ?? 'null'));
};

describe('a pull', () => {
  test(
    'cold starts racing on one cache all succeed, on the same SHA',
    async () => {
      const source = makeSourceRepository();
      const cwd = makeTempDirectory({ prefix: 'atlas-consumer-' });
      const starts = await Promise.all(
        [1, 2, 3].map(() => startInProcess({ url: source.url, cwd, cacheDir })),
      );
      const sha = git({ cwd: source.work, args: ['rev-parse', 'HEAD'] });

      // A failed start shows its stderr - what it hit is the finding.
      expect(starts.map((start) => (start.exitCode === 0 ? 'ok' : start.stderr))).toEqual([
        'ok',
        'ok',
        'ok',
      ]);
      expect(starts.map((start) => start.stdout)).toEqual(
        [1, 2, 3].map(() => JSON.stringify({ sha })),
      );
    },
    { timeout: 90_000 },
  );

  test('keeps the newest three SHAs of a source and removes the older ones', async () => {
    const source = makeSourceRepository();
    const cwd = makeTempDirectory({ prefix: 'atlas-consumer-' });
    const sources = [{ name: 'src', repo: source.url, ref: 'develop' }];
    const pulled: string[] = [];

    for (const step of [1, 2, 3, 4]) {
      if (step > 1) {
        writeSourceFile({
          work: source.work,
          path: `docs/changelogs/2026-02-0${step}-step.md`,
          text: `---\ntitle: Step ${step}\npackages: ['@x/kernel']\n---\n\nStep ${step}.\n`,
        });
        commitAll({ work: source.work, message: `docs: step ${step}` });
        git({ cwd: source.work, args: ['push', '-q', 'origin', 'develop'] });
      }

      const [resolved] = await SourceResolver.resolve({ cwd, sources, cacheDir });

      pulled.push(resolved.sha ?? '');
    }

    const cacheRoot = SourceCache.cacheRootOf({ repo: source.url, cacheBase: cacheDir });
    const entries = readdirSync(cacheRoot);
    const kept = pulled.slice(1).sort();

    expect(entries.filter((name) => /^[0-9a-f]{40}$/.test(name)).sort()).toEqual(kept);
    expect(entries.filter((name) => name.endsWith('.atlas')).sort()).toEqual(
      kept.map((sha) => `${sha}.atlas`),
    );
    expect(
      git({ cwd: join(cacheRoot, 'git'), args: ['worktree', 'list', '--porcelain'] }),
    ).not.toContain(pulled[0]);
  });

  test('a source keeps the SHAs of its newest five refs only, so a pinned release no longer stays for good', async () => {
    const source = makeSourceRepository();
    const cwd = makeTempDirectory({ prefix: 'atlas-consumer-' });
    const cacheRoot = SourceCache.cacheRootOf({ repo: source.url, cacheBase: cacheDir });

    for (const step of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      writeSourceFile({
        work: source.work,
        path: `docs/changelogs/2026-03-0${step}-step.md`,
        text: `---\ntitle: Step ${step}\npackages: ['@x/kernel']\n---\n\nStep ${step}.\n`,
      });
      commitAll({ work: source.work, message: `docs: step ${step}` });
      git({ cwd: source.work, args: ['tag', `v${step}`] });
      git({ cwd: source.work, args: ['push', '-q', 'origin', 'develop', `v${step}`] });

      await SourceResolver.resolve({
        cwd,
        sources: [{ name: 'src', repo: source.url, ref: `v${step}` }],
        cacheDir,
      });

      // The mtime orders the refs; a fast machine would give two of them the same one.
      utimesSync(
        join(cacheRoot, 'refs', `ref-v${step}`),
        new Date(1_000_000 * step),
        new Date(1_000_000 * step),
      );
    }

    const refs = readdirSync(join(cacheRoot, 'refs')).sort();
    const sets = readdirSync(cacheRoot).filter((name) => /^[0-9a-f]{40}$/.test(name));

    expect(refs).toEqual(['ref-v5', 'ref-v6', 'ref-v7', 'ref-v8', 'ref-v9']);
    // The five refs' SHAs, and the one a ref that just left held until the next pull prunes it.
    expect(sets.length).toBeLessThanOrEqual(6);
  });

  test('a clone directory a killed pull left empty is cloned again, by a start and by pull', async () => {
    const source = makeSourceRepository();
    const cwd = makeTempDirectory({ prefix: 'atlas-consumer-' });
    const sources = [{ name: 'src', repo: source.url, ref: 'develop' }];
    const gitDir = join(SourceCache.cacheRootOf({ repo: source.url, cacheBase: cacheDir }), 'git');

    mkdirSync(gitDir, { recursive: true });
    writeFileSync(join(gitDir, 'config'), 'half a clone\n');

    const [started] = await SourceResolver.resolve({ cwd, sources, cacheDir });

    expect(started.mode).toBe('fresh');

    rmSync(gitDir, { recursive: true, force: true });
    mkdirSync(gitDir);

    const [pulled] = await SourceResolver.resolve({ cwd, sources, cacheDir, force: true });

    expect(pulled.mode).toBe('fresh');
    expect(git({ cwd: gitDir, args: ['rev-parse', '--is-bare-repository'] })).toBe('true');
  });

  test('a bundle committed as a symlink to a directory outside serves nothing from it', async () => {
    const source = makeSourceRepository();
    const outside = makeTempDirectory({ prefix: 'atlas-outside-' });

    writeSourceFile({
      work: outside,
      path: 'zanzibar.md',
      text: '---\ntype: Concept\ntitle: Zanzibar\ndescription: Outside.\n---\n\nThe zanzibar archipelago.\n',
    });
    rmSync(join(source.work, '.agents/knowledge'), { recursive: true });
    symlinkSync(outside, join(source.work, '.agents/knowledge'));
    commitAll({ work: source.work, message: 'chore: a symlinked bundle' });
    git({ cwd: source.work, args: ['push', '-q', 'origin', 'develop'] });

    const resolved = await SourceResolver.resolve({
      cwd: makeTempDirectory({ prefix: 'atlas-consumer-' }),
      sources: [{ name: 'src', repo: source.url, ref: 'develop' }],
      cacheDir,
    });

    expect(lstatSync(join(resolved[0].root, '.agents/knowledge')).isSymbolicLink()).toBe(false);
    const result = await searchFor({ resolved, query: 'zanzibar archipelago' });
    expect(result).not.toContain('Zanzibar');
    // Positive control: the changelog beside it is still served.
    const result2 = await searchFor({ resolved, query: 'first change' });
    expect(result2).toContain('2026-01-01-first');
  });
});
