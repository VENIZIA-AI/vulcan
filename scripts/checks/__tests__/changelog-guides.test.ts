import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  codeHtml,
  guidePaths,
  guidesFromFiles,
  orderBlocks,
  parseGuide,
} from '../../../docs/wiki/site/.vitepress/theme/shared/changelog-guides.ts';

const YAML = `
rename-old:
  symbols: [Old, Old.run]
  upgrade:
    before: |
      // before
      old.run()
    after: |
      new.run()
    steps:
      - Replace \`old.run()\` with \`new.run()\`.
      - Run bun check.
  downgrade:
    steps:
      - Pin the earlier version.
  data: Stored rows keep the old shape. See \`migrate\`.
  codemod: rename-old

by-hand:
  symbols:
    - '@a/kernel/sub'
  upgrade:
    steps:
      - Edit it.
  downgrade:
    before: "b"
    after: "a"

second-codemod:
  symbols: [Two]
  codemod: two
  upgrade: { steps: ["Run it."] }
  downgrade: { steps: ["Back."] }
`;

describe('parseGuide', () => {
  const blocks = parseGuide({ text: YAML });

  test('reads every block in file order, with the symbols, the steps, the code and the data note', () => {
    expect(blocks.map((block) => block.id)).toEqual(['rename-old', 'by-hand', 'second-codemod']);
    expect(blocks[0].symbols).toEqual(['Old', 'Old.run']);
    expect(blocks[0].steps).toEqual(['Replace `old.run()` with `new.run()`.', 'Run bun check.']);
    expect(blocks[0].beforeHtml).toContain('old.run()');
    expect(blocks[0].afterHtml).toContain('new.run()');
    expect(blocks[0].dataHtml).toBe(
      '<p>Stored rows keep the old shape. See <code>migrate</code>.</p>',
    );
    expect(blocks[0].codemod).toBe('rename-old');
  });

  test('a block with no steps (an older upgrade of code only) has an empty list; the way back may be code', () => {
    expect(blocks[1].steps).toEqual(['Edit it.']);
    expect(blocks[1].downgrade).toEqual({ steps: [], beforeHtml: 'b', afterHtml: 'a' });
  });

  test('a text that is not a map of blocks gives none, and never throws', () => {
    expect(parseGuide({ text: '' })).toEqual([]);
    expect(parseGuide({ text: '{}' })).toEqual([]);
    expect(parseGuide({ text: 'a: [unclosed' })).toEqual([]);
    expect(parseGuide({ text: '- a\n- b\n' })).toEqual([]);
  });
});

describe('orderBlocks', () => {
  test('the blocks a codemod covers come first, each group in file order', () => {
    expect(orderBlocks({ blocks: parseGuide({ text: YAML }) }).map((block) => block.id)).toEqual([
      'rename-old',
      'second-codemod',
      'by-hand',
    ]);
  });
});

describe('codeHtml', () => {
  test('escapes the code and marks a comment line', () => {
    expect(codeHtml({ code: '// note\nconst a = 1 < 2;\n' })).toBe(
      '<span class="c">// note</span>\nconst a = 1 &lt; 2;',
    );
  });
});

describe('guidesFromFiles and guidePaths', () => {
  test('the version folders whose migration.yaml holds a block, newest first, as the params of a page', () => {
    const directory = mkdtempSync(join(tmpdir(), 'guide-files-'));

    try {
      const folder = (name: string, yaml: string): string => {
        mkdirSync(join(directory, name), { recursive: true });
        writeFileSync(join(directory, name, 'migration.yaml'), yaml);

        return join(directory, name, 'migration.yaml');
      };
      const one = (id: string): string =>
        `${id}:\n  symbols: [A]\n  upgrade: { steps: [x] }\n  downgrade: { steps: [y] }\n`;
      const files = [
        folder('0.4.9', one('a')),
        folder('0.4.10', one('b') + one('c')),
        folder('0.4.7', '{}'),
        folder('notes', one('n')),
      ];

      expect(
        guidesFromFiles({ files }).map((guide) => [guide.version, guide.blocks.length]),
      ).toEqual([
        ['0.4.10', 2],
        ['0.4.9', 1],
      ]);
      expect(guidePaths({ directory }).map((page) => page.params.version)).toEqual([
        '0.4.10',
        '0.4.9',
      ]);
      expect(guidePaths({ directory: join(directory, 'missing') })).toEqual([]);
      expect(guidesFromFiles({ files: [] })).toEqual([]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
