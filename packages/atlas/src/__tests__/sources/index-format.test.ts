import { afterAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { AtlasConstants, Corpora } from '@/common';
import { Chunker, CorpusLoader } from '@/corpus';
import { ChunkStore } from '@/search/store';
import { makeTempDirectory, TEMP_DIRECTORIES, writeSourceFile } from './source-repo.helper';

afterAll(() => {
  for (const directory of TEMP_DIRECTORIES) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/**
 * The format lock. A source's index is cached and, later, downloaded: a reader may only use one built
 * at its own `INDEX_FORMAT`. So whatever the chunker puts into the index, and the table it sits in,
 * is tied to that number here: a change that moves the digest below fails this test until
 * `AtlasConstants.INDEX_FORMAT` is raised and the pair is updated together.
 *
 * What it does not lock: query-time ranking (the weights and the planner are not stored in the index).
 */
const LOCKED = {
  format: 1,
  digest: '1671fe0b5a66b59820f2c610b96fe5603f06ca2af5e9c23dd86655dedc5807d0',
};

const LONG_SECTION = Array.from(
  { length: 60 },
  (_, index) =>
    `Paragraph ${index} of the long section explains how the kernel registers an artifact and why the boot order matters.`,
).join('\n\n');

const WIKI_GUIDE = `---
title: Artifact registration guide
description: How artifacts are registered during boot.
---

# Artifact registration guide

Register an artifact with \`KernelBoot.register\` before \`start\`.

## Steps

1. Call \`register\`.
2. Call \`start\`.

\`\`\`ts
kernel.register({ name: 'cache' });
\`\`\`

| Option | Meaning |
|---|---|
| \`name\` | The artifact name |

### A short subsection

Tiny.

## The long section

${LONG_SECTION}
`;

const KNOWLEDGE_CONCEPT = `---
type: Concept
title: Lighthouse
description: The lighthouse.
tags: [overview]
---

# Lighthouse

The lighthouse keeper starts the kernel and reads \`BOOT_ORDER\` and \`kernel.boot.order\`.
`;

const CHANGELOG_ENTRY = `---
title: "kernel 1.0.0: first release"
description: The first release.
packages: ['@acme/kernel']
---

# Changelog - 2026-01-01

## kernel 1.0.0: first release

Everything is new.
`;

/** The rows of the index the fixture corpus builds, in the order the table stores them. */
const rowsOfFixtureIndex = (): unknown[] => {
  const work = makeTempDirectory({ prefix: 'atlas-format-lock-' });

  writeSourceFile({ work, path: 'wiki/guide.md', text: WIKI_GUIDE });
  writeSourceFile({ work, path: 'knowledge/overview/lighthouse.md', text: KNOWLEDGE_CONCEPT });
  writeSourceFile({ work, path: 'changelogs/2026-01-01-first.md', text: CHANGELOG_ENTRY });

  const documents = CorpusLoader.getInstance().load({
    roots: [
      { corpus: Corpora.WIKI, directory: join(work, 'wiki') },
      { corpus: Corpora.KNOWLEDGE, directory: join(work, 'knowledge') },
      { corpus: Corpora.CHANGELOG, directory: join(work, 'changelogs') },
    ],
  });
  const store = new ChunkStore();
  const chunker = Chunker.getInstance();

  store.add({ chunks: documents.flatMap((document) => chunker.chunk({ document })) });

  const database = Database.deserialize(store.serialize());
  const rows = database
    .query(
      `SELECT id, corpus, document, anchor, heading_path, title, body, symbols, metadata, authority
       FROM chunks ORDER BY rowid`,
    )
    .all();

  database.close();
  store.close();

  return rows;
};

describe('INDEX_FORMAT', () => {
  test('the fixture corpus builds the rows the format was locked at (C4)', () => {
    const rows = rowsOfFixtureIndex();
    const digest = new Bun.CryptoHasher('sha256').update(JSON.stringify(rows)).digest('hex');

    expect(rows.length).toBeGreaterThan(4);

    // A failure here means the index changed. Raise AtlasConstants.INDEX_FORMAT, then set both
    // LOCKED.format and LOCKED.digest to the new values: that is the whole procedure.
    expect({ format: AtlasConstants.INDEX_FORMAT, digest }).toEqual(LOCKED);
  });
});
