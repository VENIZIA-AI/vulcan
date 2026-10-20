import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { lstatSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSourcesServer } from '@/server/index';
import { cacheRootOf, resolveSources } from '@/sources';
import { restoreVariable } from '../env.helper';
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

const previousCache = process.env.XDG_CACHE_HOME;

beforeEach(() => {
  process.env.XDG_CACHE_HOME = makeTempDirectory({ prefix: 'atlas-cache-' });
  process.env.VULCAN_NPM_REGISTRY = NO_REGISTRY;
});

afterEach(() => {
  restoreVariable({ name: 'XDG_CACHE_HOME', value: previousCache });
  delete process.env.VULCAN_NPM_REGISTRY;
});

const SOURCES_MODULE = join(__dirname, '../../sources/index.ts');

/** One cold start in its own process - what three MCP clients starting at once amount to. */
const startInProcess = async (opts: { url: string; cwd: string }) => {
  const script = [
    `const { resolveSources } = require(${JSON.stringify(SOURCES_MODULE)});`,
    `resolveSources({ cwd: ${JSON.stringify(opts.cwd)}, sources: [{ name: 'src', repo: ${JSON.stringify(opts.url)}, ref: 'develop' }] })`,
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
  resolved: Awaited<ReturnType<typeof resolveSources>>;
  query: string;
}) => {
  const server = buildSourcesServer({
    sources: opts.resolved,
    cwd: opts.resolved[0].root,
    version: '0.0.0',
  });

  return JSON.stringify(
    JSON.parse(
      (await server.handleLine({
        line: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'search', arguments: { query: opts.query } },
        }),
      })) ?? 'null',
    ),
  );
};

describe('a pull', () => {
  test(
    'cold starts racing on one cache all succeed, on the same SHA',
    async () => {
      const source = makeSourceRepository();
      const cwd = makeTempDirectory({ prefix: 'atlas-consumer-' });
      const starts = await Promise.all(
        [1, 2, 3].map(() => startInProcess({ url: source.url, cwd })),
      );
      const sha = git({ cwd: source.work, args: ['rev-parse', 'HEAD'] });

      // A failed start shows its stderr - what it hit is the finding.
      expect(starts.map(start => (start.exitCode === 0 ? 'ok' : start.stderr))).toEqual([
        'ok',
        'ok',
        'ok',
      ]);
      expect(starts.map(start => start.stdout)).toEqual(
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

      const [resolved] = await resolveSources({ cwd, sources });

      pulled.push(resolved.sha ?? '');
    }

    const cacheRoot = cacheRootOf({ repo: source.url });
    const entries = readdirSync(cacheRoot);
    const kept = pulled.slice(1).sort();

    expect(entries.filter(name => /^[0-9a-f]{40}$/.test(name)).sort()).toEqual(kept);
    expect(entries.filter(name => name.endsWith('.atlas')).sort()).toEqual(
      kept.map(sha => `${sha}.atlas`),
    );
    expect(
      git({ cwd: join(cacheRoot, 'git'), args: ['worktree', 'list', '--porcelain'] }),
    ).not.toContain(pulled[0]);
  });

  test('a clone directory a killed pull left empty is cloned again, by a start and by pull', async () => {
    const source = makeSourceRepository();
    const cwd = makeTempDirectory({ prefix: 'atlas-consumer-' });
    const sources = [{ name: 'src', repo: source.url, ref: 'develop' }];
    const gitDir = join(cacheRootOf({ repo: source.url }), 'git');

    mkdirSync(gitDir, { recursive: true });
    writeFileSync(join(gitDir, 'config'), 'half a clone\n');

    const [started] = await resolveSources({ cwd, sources });

    expect(started.mode).toBe('fresh');

    rmSync(gitDir, { recursive: true, force: true });
    mkdirSync(gitDir);

    const [pulled] = await resolveSources({ cwd, sources, force: true });

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

    const resolved = await resolveSources({
      cwd: makeTempDirectory({ prefix: 'atlas-consumer-' }),
      sources: [{ name: 'src', repo: source.url, ref: 'develop' }],
    });

    expect(lstatSync(join(resolved[0].root, '.agents/knowledge')).isSymbolicLink()).toBe(false);
    expect(await searchFor({ resolved, query: 'zanzibar archipelago' })).not.toContain('Zanzibar');
    // Positive control: the changelog beside it is still served.
    expect(await searchFor({ resolved, query: 'first change' })).toContain('2026-01-01-first');
  });
});
