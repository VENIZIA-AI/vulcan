import { RpcError } from '@/protocol/common';
import { buildServer } from '@/server';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, spyOn, test } from 'bun:test';
// __dirname, not import.meta: this package emits CommonJS. A project read from its own committed
// manifest; changes and symbol over a project are server/repo-releases and server/repo-symbols.
const REPOSITORY_ROOT = join(__dirname, 'fixtures', 'acme');
const TEST_VERSION = '0.0.0-test';

const tempDirectories: string[] = [];

const makeTempDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-server-test-'));

  tempDirectories.push(directory);

  return directory;
};

afterEach(() => {
  for (const directory of tempDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }

  tempDirectories.length = 0;
});

const parseReply = (
  line: string | null,
): {
  result?: {
    tools?: { name: string }[];
    content?: { text: string }[];
    serverInfo?: { version?: string };
  };
  error?: { message: string };
} => JSON.parse(line ?? 'null');

const listToolNames = async (opts: {
  transport: ReturnType<typeof buildServer>;
}): Promise<string[]> => {
  const reply = parseReply(
    await opts.transport.handleLine({
      line: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    }),
  );

  return (reply.result?.tools ?? []).map(tool => tool.name);
};

describe('buildServer', () => {
  test('repo mode exposes exactly the search, get, symbol, version, changes and presets tools', async () => {
    const transport = buildServer({
      root: REPOSITORY_ROOT,
      version: TEST_VERSION,
    });

    expect(await listToolNames({ transport })).toEqual([
      'search',
      'get',
      'symbol',
      'version',
      'changes',
      'presets',
    ]);
  });

  test('serverInfo.version is whatever version buildServer was given, not a hardcoded string (I6)', async () => {
    const transport = buildServer({
      root: REPOSITORY_ROOT,
      version: TEST_VERSION,
    });
    const reply = parseReply(
      await transport.handleLine({
        line: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      }),
    );

    expect(reply.result?.serverInfo?.version).toBe(TEST_VERSION);
  });

  test('a root with no manifest throws a plain, RpcError-free error before any stdout write', () => {
    const root = makeTempDirectory();
    const writeSpy = spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      let caught: unknown;

      try {
        buildServer({ root, version: TEST_VERSION });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(Error);
      expect(caught).not.toBeInstanceOf(RpcError);

      expect(writeSpy).not.toHaveBeenCalled();
    } finally {
      writeSpy.mockRestore();
    }
  });
});
