import { buildServer } from '@/server';
import { join } from 'node:path';
import { expect, test } from 'bun:test';

// A project shaped unlike IGNIS: one package, no wiki, the bundle at docs/knowledge, changelogs at
// changes/ - atlas serves it from its manifest alone.
const ACME = join(__dirname, '..', 'fixtures', 'acme');

const call = async (opts: {
  transport: ReturnType<typeof buildServer>;
  method: string;
  params?: object;
}): Promise<{ result?: Record<string, unknown>; error?: { message: string } }> =>
  JSON.parse(
    (await opts.transport.handleLine({
      line: JSON.stringify({ jsonrpc: '2.0', id: 1, method: opts.method, params: opts.params }),
    })) ?? 'null',
  );

const searchText = async (opts: {
  transport: ReturnType<typeof buildServer>;
  query: string;
}): Promise<string> => {
  const reply = await call({
    transport: opts.transport,
    method: 'tools/call',
    params: { name: 'search', arguments: { query: opts.query } },
  });
  const content = reply.result?.content;

  return Array.isArray(content) ? JSON.stringify(content) : '';
};

test('repo mode serves a project from its manifest: its own name, its bundle and changelogs', async () => {
  const transport = buildServer({ root: ACME, version: '0.0.0' });
  const initialized = await call({ transport, method: 'initialize', params: {} });

  expect(JSON.stringify(initialized.result)).toContain('acme-atlas');
  expect(await searchText({ transport, query: 'flywheel engine' })).toContain(
    'okf:overview/core.md',
  );
  expect(await searchText({ transport, query: 'flywheel spins' })).toContain('changelog:');
  expect(await searchText({ transport, query: 'flywheel spins' })).not.toContain('wiki:');
});
