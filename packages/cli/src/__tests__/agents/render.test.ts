import { describe, expect, test } from 'bun:test';
import {
  CODEX_BLOCK_END,
  CODEX_BLOCK_START,
  atlasServerEntry,
  mergeCodexToml,
  mergeMcpServers,
} from '../../agents/index.ts';

const ROOT = '/work/demo';
const ENTRY = {
  command: 'bun',
  args: [`${ROOT}/node_modules/.bin/vulcan`, 'x', 'atlas', 'mcp', '--root', ROOT],
};

describe('atlasServerEntry', () => {
  test("calls the project's own vulcan by absolute path, so the starting directory does not matter", () => {
    expect(atlasServerEntry({ root: ROOT })).toEqual(ENTRY);
  });
});

describe('mergeMcpServers (mcpServers)', () => {
  const merge = (opts: { text: string | undefined }) =>
    mergeMcpServers({ text: opts.text, key: 'mcpServers', entry: ENTRY });

  test('no file yet: a new one holding only the atlas entry', () => {
    const result = merge({ text: undefined });

    expect(result).toEqual({
      ok: true,
      changed: true,
      text: `${JSON.stringify({ mcpServers: { atlas: ENTRY } }, null, 2)}\n`,
    });
  });

  test('other servers and other keys stay, in order, and atlas is added last', () => {
    const before = JSON.stringify({
      theme: 'dark',
      mcpServers: { zed: { command: 'z' } },
      tail: 1,
    });
    const result = merge({ text: before });

    expect(result.ok && JSON.parse(result.text)).toEqual({
      theme: 'dark',
      mcpServers: { zed: { command: 'z' }, atlas: ENTRY },
      tail: 1,
    });
    expect(result.ok && Object.keys(JSON.parse(result.text))).toEqual([
      'theme',
      'mcpServers',
      'tail',
    ]);
    expect(result.ok && Object.keys(JSON.parse(result.text).mcpServers)).toEqual(['zed', 'atlas']);
  });

  test("an atlas entry that is already there is the user's: left as it is, nothing changes", () => {
    const before = `${JSON.stringify({ mcpServers: { atlas: { command: 'mine' } } }, null, 2)}\n`;

    expect(merge({ text: before })).toEqual({ ok: true, changed: false, text: before });
  });

  test('a file without the server map gets one', () => {
    const result = merge({ text: '{ "other": true }' });

    expect(result.ok && JSON.parse(result.text)).toEqual({
      other: true,
      mcpServers: { atlas: ENTRY },
    });
  });

  test('invalid JSON, or JSON that is not an object, is not touched', () => {
    expect(merge({ text: '{ nope' })).toEqual({ ok: false, reason: 'not valid JSON' });
    expect(merge({ text: '[1]' })).toEqual({ ok: false, reason: 'not a JSON object' });
    expect(merge({ text: '{ "mcpServers": [] }' })).toEqual({
      ok: false,
      reason: 'mcpServers is not an object',
    });
  });
});

describe('mergeMcpServers (servers, for VS Code)', () => {
  test('uses the servers key and a stdio type', () => {
    const result = mergeMcpServers({
      text: undefined,
      key: 'servers',
      entry: { type: 'stdio', ...ENTRY },
    });

    expect(result.ok && JSON.parse(result.text)).toEqual({
      servers: { atlas: { type: 'stdio', ...ENTRY } },
    });
  });

  test('keeps the inputs list VS Code files carry', () => {
    const before = JSON.stringify({ inputs: [{ id: 'k' }], servers: {} });
    const result = mergeMcpServers({
      text: before,
      key: 'servers',
      entry: { type: 'stdio', ...ENTRY },
    });

    expect(result.ok && JSON.parse(result.text).inputs).toEqual([{ id: 'k' }]);
  });
});

describe('mergeCodexToml', () => {
  const block = (): string =>
    [
      CODEX_BLOCK_START,
      '[mcp_servers.atlas]',
      'command = "bun"',
      `args = ["${ROOT}/node_modules/.bin/vulcan", "x", "atlas", "mcp", "--root", "${ROOT}"]`,
      CODEX_BLOCK_END,
      '',
    ].join('\n');

  test('markers are the documented comment lines', () => {
    expect(CODEX_BLOCK_START).toBe('# vulcan:atlas:start');
    expect(CODEX_BLOCK_END).toBe('# vulcan:atlas:end');
  });

  test('no file yet: only the block', () => {
    expect(mergeCodexToml({ text: undefined, root: ROOT })).toEqual({
      ok: true,
      changed: true,
      text: block(),
    });
  });

  test('other settings stay and the block is appended after a blank line', () => {
    const before = 'model = "gpt"\n\n[mcp_servers.other]\ncommand = "x"\n';
    const result = mergeCodexToml({ text: before, root: ROOT });

    expect(result).toEqual({ ok: true, changed: true, text: `${before}\n${block()}` });
  });

  test('the same block again changes nothing', () => {
    expect(mergeCodexToml({ text: block(), root: ROOT })).toEqual({
      ok: true,
      changed: false,
      text: block(),
    });
  });

  test('a block written for another root is replaced between its markers, the rest untouched', () => {
    const old = block().replaceAll(ROOT, '/old/place');
    const before = `model = "gpt"\n\n${old}\n[tail]\nx = 1\n`;
    const result = mergeCodexToml({ text: before, root: ROOT });

    expect(result).toEqual({
      ok: true,
      changed: true,
      text: `model = "gpt"\n\n${block()}\n[tail]\nx = 1\n`,
    });
  });

  test('an atlas table the user wrote outside the markers is left alone and reported', () => {
    const before = '[mcp_servers.atlas]\ncommand = "mine"\n';

    expect(mergeCodexToml({ text: before, root: ROOT })).toEqual({
      ok: false,
      reason: 'a [mcp_servers.atlas] table is already there outside the vulcan markers',
    });
  });
});
