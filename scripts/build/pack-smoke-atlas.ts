#!/usr/bin/env bun
/**
 * Proves the packed tarball starts outside the workspace: pack, install into an empty directory,
 * name a local bare repository with `--source`, and run `initialize` + `tools/list` + one
 * `search` over stdio. atlas ships code only, so the hit has to come from that source. Catches a
 * dependency the workspace hoists but the manifest never declared - the gate `bun test` cannot see.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { useRepoTmp } from '../test/repo-tmp.ts';

const PACKAGE_DIRECTORY = resolve(import.meta.dir, '..', '..', 'packages', 'atlas');
const PACKAGE_NAME = '@venizia/vulcan-atlas';

// A registry that refuses at once: the pull's npm symbol step skips instead of reaching npm.
const NO_REGISTRY = 'http://127.0.0.1:9';

const run = (opts: {
  command: string[];
  cwd: string;
  input?: string;
  env?: Record<string, string>;
}) => {
  const result = spawnSync(opts.command[0], opts.command.slice(1), {
    cwd: opts.cwd,
    input: opts.input,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'production', ...opts.env },
  });

  return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
};

class SmokeFailure extends Error {}

const fail = (message: string): never => {
  throw new SmokeFailure(message);
};

const SOURCE_MANIFEST = {
  schemaVersion: 1,
  name: 'smoke',
  packages: [
    { name: '@smoke/kernel', dir: 'kernel', path: 'packages/kernel', aliases: [], retired: false },
  ],
  knowledge: { bundle: '.agents/knowledge', changelogs: 'docs/changelogs' },
  release: { tagPattern: '<dir>-v<version>', ignoreTags: [] },
};

const SOURCE_FILES: Record<string, string> = {
  '.agents/vulcan.manifest.json': `${JSON.stringify(SOURCE_MANIFEST, null, 2)}\n`,
  '.agents/knowledge/overview/bootstrap.md':
    '---\ntype: Concept\ntitle: Application bootstrap\ndescription: How the application boots.\n---\n\nThe application bootstrap starts the kernel.\n',
};

const git = (opts: { cwd: string; args: string[] }): void => {
  const result = run({
    command: ['git', '-c', 'user.name=smoke', '-c', 'user.email=smoke@smoke', ...opts.args],
    cwd: opts.cwd,
  });

  if (result.status !== 0) {
    fail(`git ${opts.args.join(' ')} exited ${result.status}\n${result.stderr}`);
  }
};

/** A source project behind a bare repository: its committed manifest and one concept. */
const makeSource = (opts: { sandbox: string }): string => {
  const bare = join(opts.sandbox, 'source.git');
  const work = join(opts.sandbox, 'source');

  mkdirSync(bare);
  mkdirSync(work);
  git({ cwd: bare, args: ['init', '-q', '--bare', '-b', 'develop'] });
  git({ cwd: work, args: ['init', '-q', '-b', 'develop'] });

  for (const [path, content] of Object.entries(SOURCE_FILES)) {
    mkdirSync(dirname(join(work, path)), { recursive: true });
    writeFileSync(join(work, path), content);
  }

  git({ cwd: work, args: ['add', '-A'] });
  git({ cwd: work, args: ['commit', '-q', '-m', 'source'] });
  git({ cwd: work, args: ['push', '-q', bare, 'develop'] });

  return bare;
};

const main = (): void => {
  const packed = run({ command: ['bun', 'pm', 'pack', '--quiet'], cwd: PACKAGE_DIRECTORY });

  if (packed.status !== 0) {
    fail(`bun pm pack exited ${packed.status}\n${packed.stderr}`);
  }

  const tarball = readdirSync(PACKAGE_DIRECTORY)
    .filter(name => name.endsWith('.tgz'))
    .map(name => join(PACKAGE_DIRECTORY, name))
    .sort()
    .at(-1);

  if (!tarball) {
    fail('no tarball produced');
  }

  const sandbox = mkdtempSync(join(useRepoTmp(), 'vulcan-atlas-smoke-'));

  try {
    // Its own manifest first: without one `bun add` would take the nearest package.json above the sandbox.
    writeFileSync(join(sandbox, 'package.json'), JSON.stringify({ name: 'smoke', private: true }));

    const installed = run({ command: ['bun', 'add', tarball!], cwd: sandbox });

    if (installed.status !== 0) {
      fail(`bun add ${tarball} exited ${installed.status}\n${installed.stderr}`);
    }

    const bare = makeSource({ sandbox });
    const cli = join(sandbox, 'node_modules', ...PACKAGE_NAME.split('/'), 'dist', 'cjs', 'cli.js');
    const input = [
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'pack-smoke', version: '0' },
        },
      },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'search', arguments: { query: 'application bootstrap' } },
      },
    ]
      .map(message => JSON.stringify(message))
      .join('\n');

    const session = run({
      command: ['bun', cli, 'mcp', '--source', `file://${bare}@develop`, '--cache-dir', join(sandbox, 'cache')],
      cwd: sandbox,
      input: `${input}\n`,
      env: { VULCAN_NPM_REGISTRY: NO_REGISTRY },
    });

    if (session.status !== 0) {
      fail(`cli exited ${session.status}\n${session.stderr.slice(-2000)}`);
    }

    const lines = session.stdout.split('\n').filter(line => line.length > 0);
    const messages = lines.map(line => {
      try {
        return JSON.parse(line) as { id?: number; result?: Record<string, unknown> };
      } catch {
        return fail(`stdout carries a non-JSON line: ${line.slice(0, 120)}`);
      }
    });

    const toolList = messages.find(message => message.id === 2)?.result as
      | { tools?: { name: string }[] }
      | undefined;
    const names = (toolList?.tools ?? []).map(tool => tool.name).sort();
    const expected = 'changes,get,presets,search,symbol,version';

    if (names.join(',') !== expected) {
      fail(
        `tools/list returned [${names.join(', ')}], expected [${expected.split(',').join(', ')}]`,
      );
    }

    const searched = messages.find(message => message.id === 3)?.result as
      | { content?: { text: string }[] }
      | undefined;
    const payload = JSON.parse(searched?.content?.[0]?.text ?? '{}') as { total?: number };

    if (!payload.total || payload.total < 1) {
      fail(`search returned no hits from the source: ${JSON.stringify(payload).slice(0, 200)}`);
    }

    console.log(
      `pack-smoke: OK - ${names.join(', ')} listed, search total ${payload.total}, ${lines.length} JSON-RPC lines on stdout, stderr ${session.stderr.length} chars`,
    );
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
    rmSync(tarball!, { force: true });
  }
};

try {
  main();
} catch (error) {
  if (error instanceof SmokeFailure) {
    console.error(`pack-smoke: FAIL - ${error.message}`);
    process.exit(1);
  }

  throw error;
}
