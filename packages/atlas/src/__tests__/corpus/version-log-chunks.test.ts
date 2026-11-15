import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Corpora } from '@/common';
import { Chunker, CorpusLoader } from '@/corpus';
import { Transport } from '@/protocol';
import { ChunkStore } from '@/search/store';
import { GetTool } from '@/tools/get.tool';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const LOG = `---
title: 0.4.8
version: 0.4.8
packages: ['@a/kernel']
---
The 0.4.8 line.

## Breaking
- **Factory only** \`thing-factory\` (\`@a/kernel\`): call \`ThingFactory.build\`.
  The old \`Thing.make\` is gone.

\`\`\`ts
// a fenced example under the item
## not a heading
\`\`\`

## Added
- **A flag** \`a-flag\`: new.
`;

const MIGRATION = `thing-factory:
  symbols: [Thing.make]
  upgrade: { before: "Thing.make()", after: "ThingFactory.build()" }
  downgrade: { steps: ["Use Thing.make() again"] }
`;

const storeOf = (): ChunkStore => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-version-log-'));

  roots.push(root);
  mkdirSync(join(root, '0.4.8'));
  writeFileSync(join(root, '0.4.8', 'log.md'), LOG);
  writeFileSync(join(root, '0.4.8', 'migration.yaml'), MIGRATION);
  writeFileSync(
    join(root, '2026-01-01-thing.md'),
    '---\ntitle: Thing\npackages: []\n---\n\n## A sample change\n\nSomething changed in a way people will want to read about, with enough text to stand as its own chunk of the entry.\n',
  );

  const documents = CorpusLoader.getInstance().load({
    roots: [{ corpus: Corpora.CHANGELOG, directory: root }],
  });
  const store = new ChunkStore();

  store.add({ chunks: documents.flatMap((document) => Chunker.getInstance().chunk({ document })) });

  return store;
};

const callGet = async (opts: { store: ChunkStore; args: Record<string, unknown> }) => {
  const transport = new Transport({
    tools: [GetTool.build({ store: opts.store })],
    serverName: 'atlas-test',
    serverVersion: '0.0.0',
  });
  const reply = await transport.handleLine({
    line: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'get', arguments: opts.args },
    }),
  });
  const parsed = JSON.parse(reply ?? 'null');

  return { error: parsed.error, result: JSON.parse(parsed.result?.content[0]?.text ?? 'null') };
};

describe('a version folder log in the index (C17)', () => {
  const store = storeOf();

  test('one chunk per item, cited by the item id, and the intro; dated entries keep their ids', () => {
    expect(store.get({ id: 'changelog:0.4.8#thing-factory' })?.title).toBe('Factory only');
    expect(store.get({ id: 'changelog:0.4.8#a-flag' })?.headingPath).toBe('0.4.8 > Added > A flag');
    expect(store.get({ id: 'changelog:0.4.8#' })?.body).toBe('The 0.4.8 line.');
    expect(store.get({ id: 'changelog:2026-01-01-thing#a-sample-change' })).toBeDefined();
  });

  test('the item with a block carries the block; the one without carries none', () => {
    const factory = store.get({ id: 'changelog:0.4.8#thing-factory' });

    expect(factory?.body).toContain('Migration:');
    expect(factory?.body).toContain('ThingFactory.build()');
    expect(factory?.body).toContain('a fenced example under the item');
    expect(factory?.symbols).toContain('Thing');
    expect(store.get({ id: 'changelog:0.4.8#a-flag' })?.body).not.toContain('Migration:');
  });

  test('get reads an item by its id, and the whole folder by its name', async () => {
    const item = await callGet({ store, args: { id: 'changelog:0.4.8#thing-factory' } });
    const whole = await callGet({ store, args: { id: 'changelog:0.4.8' } });

    expect(item.result.body).toContain('Migration:');
    expect(whole.result.body).toContain('A flag');
    expect(whole.result.body).toContain('Factory only');
  });
});
