import { buildServer } from '@/server';
import { afterAll, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = mkdtempSync(join(tmpdir(), 'atlas-repo-releases-'));

afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

const git = (args: string[]): void => {
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd: ROOT,
    stdio: 'ignore',
  });
};

test('repo mode answers changes from git: tags and declared changelogs, no release table', async () => {
  mkdirSync(join(ROOT, '.agents/knowledge'), { recursive: true });
  mkdirSync(join(ROOT, 'changes'));
  writeFileSync(
    join(ROOT, '.agents/vulcan.manifest.json'),
    JSON.stringify({
      schemaVersion: 1,
      name: 'acme',
      packages: [{ name: '@acme/core', dir: 'core', aliases: [], retired: false }],
      knowledge: { bundle: '.agents/knowledge', changelogs: 'changes' },
      release: { tagPattern: '<dir>-v<version>' },
    }),
  );
  git(['init', '-q', '-b', 'develop']);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'init']);
  git(['tag', 'core-v1.0.0']);
  writeFileSync(
    join(ROOT, 'changes/2026-01-02-faster.md'),
    "---\ntitle: Faster\npackages: ['@acme/core']\n---\n\nThe core is faster.\n",
  );
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'docs: faster']);
  git(['tag', 'core-v1.1.0']);

  const transport = buildServer({ root: ROOT, version: '0.0.0' });
  const reply = JSON.parse(
    (await transport.handleLine({
      line: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'changes', arguments: { package: 'core', from: '1.0.0', to: '1.1.0' } },
      }),
    })) ?? 'null',
  );
  const payload = JSON.parse(reply.result?.content?.[0]?.text ?? '{}');

  expect(reply.error).toBeUndefined();
  expect(payload.package).toBe('@acme/core');
  expect(payload.entries.map((entry: { id: string }) => entry.id)).toEqual([
    'changelog:2026-01-02-faster',
  ]);
});

test('repo mode with no tag the pattern reads says so on version and changes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-repo-untagged-'));

  try {
    mkdirSync(join(root, '.agents/knowledge'), { recursive: true });
    writeFileSync(
      join(root, '.agents/vulcan.manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        name: 'acme',
        packages: [{ name: '@acme/core', dir: 'core', aliases: [], retired: false }],
        release: { tagPattern: 'v<version>' },
      }),
    );
    execFileSync('git', ['init', '-q', '-b', 'develop'], { cwd: root, stdio: 'ignore' });

    const transport = buildServer({ root, version: '0.0.0' });
    const call = async (opts: { name: string; arguments: object }) =>
      JSON.parse(
        (await transport.handleLine({
          line: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: opts }),
        })) ?? 'null',
      );

    expect((await call({ name: 'version', arguments: {} })).error.message).toBe(
      'no releases: no tag matches v<version>',
    );
    expect((await call({ name: 'changes', arguments: {} })).error.message).toBe(
      'no releases: no tag matches v<version>',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
