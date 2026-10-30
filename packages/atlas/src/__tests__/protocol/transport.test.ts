import { AtlasConstants } from '@/common';
import { Transport } from '@/protocol';
import type { IToolHandler } from '@/protocol';
import { describe, expect, spyOn, test } from 'bun:test';

const echo: IToolHandler = {
  definition: {
    name: 'echo',
    description: 'echo',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
  call: async ({ args }) => args,
};
const failing: IToolHandler = {
  definition: { ...echo.definition, name: 'fail' },
  call: async () => {
    throw new Error('boom');
  },
};
const buildTransport = () =>
  new Transport({ tools: [echo], serverName: 'atlas-test', serverVersion: '0.0.0' });
const parse = (line: string | null) => JSON.parse(line ?? 'null');

describe('Transport', () => {
  test('initialize answers with the negotiated version and the server info', async () => {
    const result2 = await buildTransport().handleLine({
      line: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18' },
      }),
    });
    const reply = parse(result2);

    expect(reply.result.serverInfo.name).toBe('atlas-test');
    expect(reply.result.capabilities.tools).toEqual({});
    expect(reply.result.protocolVersion).toBe('2025-06-18');
  });

  test('initialize echoes an older supported version instead of negotiating up to the newest (M21)', async () => {
    const result2 = await buildTransport().handleLine({
      line: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05' },
      }),
    });
    const reply = parse(result2);

    expect(reply.result.protocolVersion).toBe('2024-11-05');
  });

  test('initialize answers with the newest supported version when the client requests an unsupported one (M21)', async () => {
    const result2 = await buildTransport().handleLine({
      line: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '1999-01-01' },
      }),
    });
    const reply = parse(result2);

    expect(reply.result.protocolVersion).toBe(AtlasConstants.PROTOCOL_VERSION);
  });

  test('tools/list returns every definition', async () => {
    const result2 = await buildTransport().handleLine({
      line: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    const reply = parse(result2);

    expect(reply.result.tools.map((tool: { name: string }) => tool.name)).toEqual(['echo']);
  });

  test('tools/call dispatches and wraps the result in a text content block', async () => {
    const result2 = await buildTransport().handleLine({
      line: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'echo', arguments: { text: 'hi' } },
      }),
    });
    const reply = parse(result2);

    expect(reply.result.content[0].type).toBe('text');
    expect(JSON.parse(reply.result.content[0].text)).toEqual({ text: 'hi' });
  });

  test('an unknown method is -32601; a notification gets no reply; malformed JSON gets -32700 with no id', async () => {
    const transport = buildTransport();

    const result = await transport.handleLine({
      line: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'nope' }),
    });
    expect(parse(result).error.code).toBe(-32601);
    const result2 = await transport.handleLine({
      line: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    expect(result2).toBeNull();
    const result3 = await transport.handleLine({ line: '{not json' });
    expect(parse(result3).error.code).toBe(-32700);
  });

  test('a tool that throws becomes -32603 with the message', async () => {
    const transport = new Transport({ tools: [failing], serverName: 'x', serverVersion: '0' });
    const result = await transport.handleLine({
      line: JSON.stringify({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'fail', arguments: {} },
      }),
    });
    const reply = parse(result);

    expect(reply.error).toEqual({ code: -32603, message: 'boom' });
  });

  test('tools/call with an unknown tool name is -32602 (invalid params)', async () => {
    const result = await buildTransport().handleLine({
      line: JSON.stringify({
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: { name: 'nope', arguments: {} },
      }),
    });
    const reply = parse(result);

    expect(reply.error).toEqual({ code: -32602, message: 'unknown tool: nope' });
  });

  test('handling lines writes nothing to stdout - only run() may write to it', async () => {
    const transport = new Transport({
      tools: [echo, failing],
      serverName: 'atlas-test',
      serverVersion: '0.0.0',
    });
    const writeSpy = spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      await transport.handleLine({
        line: JSON.stringify({ jsonrpc: '2.0', id: 6, method: 'initialize', params: {} }),
      });
      await transport.handleLine({
        line: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list' }),
      });
      await transport.handleLine({
        line: JSON.stringify({
          jsonrpc: '2.0',
          id: 8,
          method: 'tools/call',
          params: { name: 'echo', arguments: { text: 'hi' } },
        }),
      });
      // Both tools/call error paths log through `this.logger` - must land on stderr, not stdout.
      await transport.handleLine({
        line: JSON.stringify({
          jsonrpc: '2.0',
          id: 9,
          method: 'tools/call',
          params: { name: 'nope', arguments: {} },
        }),
      });
      await transport.handleLine({
        line: JSON.stringify({
          jsonrpc: '2.0',
          id: 10,
          method: 'tools/call',
          params: { name: 'fail', arguments: {} },
        }),
      });
      await transport.handleLine({ line: '{not json' });

      expect(writeSpy).not.toHaveBeenCalled();
    } finally {
      writeSpy.mockRestore();
    }
  });
});
