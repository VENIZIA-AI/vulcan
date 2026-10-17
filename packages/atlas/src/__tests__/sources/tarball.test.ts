import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { buildSourcesServer } from '@/server/index';
import { resolveSources } from '@/sources';
import {
  commitAll,
  git,
  makeSourceRepository,
  makeTempDirectory,
  NO_REGISTRY,
  SOURCE_MANIFEST,
  TEMP_DIRECTORIES,
  writeSourceFile,
} from './source-repo.helper';

afterAll(() => {
  for (const directory of TEMP_DIRECTORIES) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const previous = { ...process.env };
// The fake GitHub below runs git itself - by its full path, since a test takes git off PATH.
const GIT = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();

beforeEach(() => {
  process.env.XDG_CACHE_HOME = makeTempDirectory({ prefix: 'atlas-cache-' });
  process.env.VULCAN_NPM_REGISTRY = NO_REGISTRY;
});

afterEach(() => {
  for (const key of [
    'XDG_CACHE_HOME',
    'VULCAN_NPM_REGISTRY',
    'VULCAN_GITHUB_URL',
    'VULCAN_CODELOAD_URL',
    'GITHUB_TOKEN',
    'PATH',
  ]) {
    if (previous[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous[key];
    }
  }
});

/** A machine with tar and gzip but no git: PATH holds links to those two only. */
const withoutGit = (): void => {
  const bin = makeTempDirectory({ prefix: 'atlas-bin-' });

  for (const tool of ['tar', 'gzip']) {
    symlinkSync(execFileSync('which', [tool], { encoding: 'utf8' }).trim(), join(bin, tool));
  }

  process.env.PATH = bin;
};

/**
 * GitHub, as far as atlas uses it without git: the smart-HTTP ref advertisement of a repository, and
 * codeload's tarball of a commit - both served from a bare repository. It records what it was sent.
 */
const serveGitHub = (opts: { bare: string; prefix: string }) => {
  const seen: { path: string; authorization: string | null }[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: request => {
      const url = new URL(request.url);

      seen.push({ path: url.pathname, authorization: request.headers.get('authorization') });

      if (url.pathname === '/acme/src.git/info/refs') {
        const advertised = execFileSync(GIT, [
          'upload-pack',
          '--stateless-rpc',
          '--advertise-refs',
          opts.bare,
        ]);
        const service = '# service=git-upload-pack\n';
        const header = `${(service.length + 4).toString(16).padStart(4, '0')}${service}0000`;

        return new Response(Buffer.concat([Buffer.from(header), advertised]), {
          headers: { 'content-type': 'application/x-git-upload-pack-advertisement' },
        });
      }

      const archive = /^\/acme\/src\/tar\.gz\/([0-9a-f]{40})$/.exec(url.pathname);

      if (archive) {
        return new Response(
          execFileSync(
            GIT,
            ['archive', '--format=tar.gz', `--prefix=${opts.prefix}/`, archive[1]],
            {
              cwd: opts.bare,
            },
          ),
        );
      }

      return new Response('not found', { status: 404 });
    },
  });

  process.env.VULCAN_GITHUB_URL = `http://localhost:${server.port}`;
  process.env.VULCAN_CODELOAD_URL = `http://localhost:${server.port}`;

  return { server, seen };
};

describe('a source without git on the machine', () => {
  test('the commit from the ref advertisement, the declared paths from the tarball of that commit', async () => {
    const source = makeSourceRepository();
    const sha = git({ cwd: source.work, args: ['rev-parse', 'HEAD'] });
    const github = serveGitHub({ bare: source.bare, prefix: `src-${sha}` });

    withoutGit();

    try {
      const [resolved] = await resolveSources({
        cwd: makeTempDirectory({ prefix: 'atlas-consumer-' }),
        sources: [{ name: 'src', repo: 'acme/src', ref: 'develop' }],
      });

      expect(resolved.mode).toBe('fresh');
      expect(resolved.sha).toBe(sha);
      expect(existsSync(join(resolved.root, '.agents/knowledge/overview/kernel.md'))).toBe(true);
      expect(existsSync(join(resolved.root, 'docs/changelogs/2026-01-01-first.md'))).toBe(true);
      expect(existsSync(join(resolved.root, 'packages'))).toBe(false);
      expect(existsSync(join(resolved.root, '.configs'))).toBe(false);
      expect(resolved.history).toBe(false);

      const initialized = JSON.parse(
        (await buildSourcesServer({
          sources: [resolved],
          cwd: resolved.root,
          version: '0.0.0',
        }).handleLine({
          line: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
        })) ?? 'null',
      );

      expect(initialized.result.instructions).toContain('no git on this machine');
      expect(github.seen.some(request => request.path.includes('/api'))).toBe(false);

      // D1: no history without git - the tools say so, and the dated entries still answer by date.
      const server = buildSourcesServer({
        sources: [resolved],
        cwd: resolved.root,
        version: '0.0.0',
      });
      const call = async (opts: { name: string; arguments: object }) =>
        JSON.parse(
          (await server.handleLine({
            line: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: opts }),
          })) ?? 'null',
        );
      const version = await call({ name: 'version', arguments: {} });
      const byPackage = await call({ name: 'changes', arguments: { package: '@x/kernel' } });
      const byDate = await call({ name: 'changes', arguments: { to: '2026-01-01' } });

      expect(version.error.message).toBe('no release history: src was fetched without git');
      expect(byPackage.error.message).toBe('no release history: src was fetched without git');
      expect(
        JSON.parse(byDate.result.content[0].text).entries.map((found: { id: string }) => found.id),
      ).toEqual(['changelog:2026-01-01-first']);
    } finally {
      await github.server.stop(true);
    }
  });

  test('a private repository: the token goes in the request headers, never in a message', async () => {
    const source = makeSourceRepository();
    const sha = git({ cwd: source.work, args: ['rev-parse', 'HEAD'] });
    const github = serveGitHub({ bare: source.bare, prefix: `src-${sha}` });

    process.env.GITHUB_TOKEN = 'ghs_secret_value';
    withoutGit();

    try {
      await resolveSources({
        cwd: makeTempDirectory({ prefix: 'atlas-consumer-' }),
        sources: [{ name: 'src', repo: 'acme/src', ref: 'develop' }],
      });

      // The ref advertisement takes it as HTTP Basic, codeload as a token header - both carry it.
      const carries = (header: string | null): boolean =>
        (header ?? '').startsWith('Basic ')
          ? Buffer.from((header ?? '').slice('Basic '.length), 'base64')
              .toString()
              .endsWith(':ghs_secret_value')
          : header === 'token ghs_secret_value';

      expect(github.seen.length).toBeGreaterThan(1);
      expect(github.seen.every(request => carries(request.authorization))).toBe(true);

      const failure = await resolveSources({
        cwd: makeTempDirectory({ prefix: 'atlas-consumer-' }),
        sources: [{ name: 'missing', repo: 'acme/missing', ref: 'develop' }],
      }).then(
        () => undefined,
        (error: unknown) => String(error),
      );

      expect(failure).toContain("source 'missing'");
      expect(failure).not.toContain('ghs_secret_value');
    } finally {
      await github.server.stop(true);
    }
  });

  test('a declared directory with nothing in it yet resolves, from one download of the tarball', async () => {
    const source = makeSourceRepository();

    writeSourceFile({
      work: source.work,
      path: '.agents/vulcan.manifest.json',
      text: SOURCE_MANIFEST.replace('docs/changelogs', 'docs/changes'),
    });
    commitAll({ work: source.work, message: 'chore: a changelog directory not written yet' });
    git({ cwd: source.work, args: ['push', '-q', 'origin', 'develop'] });

    const sha = git({ cwd: source.work, args: ['rev-parse', 'HEAD'] });
    const github = serveGitHub({ bare: source.bare, prefix: `src-${sha}` });

    withoutGit();

    try {
      const [resolved] = await resolveSources({
        cwd: makeTempDirectory({ prefix: 'atlas-consumer-' }),
        sources: [{ name: 'src', repo: 'acme/src', ref: 'develop' }],
      });

      expect(resolved.sha).toBe(sha);
      expect(existsSync(join(resolved.root, '.agents/knowledge/overview/kernel.md'))).toBe(true);
      expect(github.seen.filter(request => request.path.includes('/tar.gz/'))).toHaveLength(1);
    } finally {
      await github.server.stop(true);
    }
  });

  test(
    'a ref advertisement that never answers fails within the ref lookup bound',
    async () => {
      const silent = Bun.listen({
        hostname: '127.0.0.1',
        port: 0,
        socket: { data: () => undefined },
      });

      process.env.VULCAN_GITHUB_URL = `http://127.0.0.1:${silent.port}`;
      withoutGit();

      const started = Date.now();

      try {
        const failure = await resolveSources({
          cwd: makeTempDirectory({ prefix: 'atlas-consumer-' }),
          sources: [{ name: 'src', repo: 'acme/src', ref: 'develop' }],
        }).then(
          () => undefined,
          (error: unknown) => String(error),
        );

        expect(failure).toContain('is unreachable and has no cache');
        // The ref lookup's bound (10 s), and room around it.
        expect(Date.now() - started).toBeLessThan(15_000);
      } finally {
        silent.stop(true);
      }
    },
    { timeout: 40_000 },
  );
});
