import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApiReference } from '@/api';
import { CorpusFrontmatter } from '@/corpus/frontmatter';
import type { ISymbolRecord } from '@/symbols';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const record = (opts: Partial<ISymbolRecord> & { name: string }): ISymbolRecord => ({
  package: '@x/kit',
  subpath: '.',
  specifier: '@x/kit',
  category: 'function',
  file: 'packages/kit/src/index.ts',
  line: 3,
  signature: `${opts.name}(): void`,
  doc: '',
  declaration: `export declare function ${opts.name}(): void;`,
  ...opts,
});

describe('ApiReference.filesOf with a long entry', () => {
  const long = (name: string) =>
    record({
      name,
      doc: 'Long.',
      declaration: `export declare const ${name}: '${'x'.repeat(6000)}';`,
    });
  const names = [
    ...Array.from({ length: 20 }, (_, at) => `value${String(at).padStart(2, '0')}`),
    'with_mark',
  ];
  const files = ApiReference.filesOf({ records: names.map(long) });
  const parts = [...files.keys()].filter((file) => file.startsWith('x-kit--part-')).sort();
  const main = files.get('x-kit.md') ?? '';

  test('the entry keeps its page and gets numbered parts, none over the limit', () => {
    expect(parts).toEqual(['x-kit--part-1.md', 'x-kit--part-2.md', 'x-kit--part-3.md']);

    for (const file of ['x-kit.md', ...parts]) {
      expect((files.get(file) ?? '').length).toBeLessThanOrEqual(ApiReference.MAX_PAGE_CHARS);
    }
  });

  test('every export is declared once, in a part, and keeps a heading on the entry page that links there', () => {
    for (const name of names) {
      const holders = parts.filter((file) => (files.get(file) ?? '').includes(`const ${name}:`));

      expect(holders).toHaveLength(1);
      expect(main).toContain(`## \`${name}\``);
    }

    expect(main).not.toContain('xxxxxxxxxx');
    expect(main).toContain('[Declaration](/references/api/x-kit--part-1#value00)');
    expect(main).toContain('[Declaration](/references/api/x-kit--part-3#with-mark)');
  });

  test('a part names its entry, its number and the way back', () => {
    const part = files.get('x-kit--part-2.md') ?? '';

    expect(part).toContain('title: "@x/kit (2 of 3)"');
    expect(part).toContain('[`@x/kit`](/references/api/x-kit)');
    expect(ApiReference.isGenerated({ text: part })).toBe(true);
  });

  test('names that differ only in case, on one part, link to the anchor the site numbers', () => {
    const split = ApiReference.filesOf({
      records: [
        ...['applicationEnvironment', 'ApplicationEnvironment', 'APPLICATIONENVIRONMENT'].map(long),
        ...Array.from({ length: 8 }, (_, at) => long(`value0${at}`)),
      ],
    });
    const page = split.get('x-kit.md') ?? '';
    // The order of the sections of the part is the order the site numbers its anchors in.
    const order = [...(split.get('x-kit--part-1.md') ?? '').matchAll(/^## `(\w+)`/gm)]
      .map((found) => found[1] ?? '')
      .filter((name) => name.toLowerCase() === 'applicationenvironment');

    expect(order).toHaveLength(3);
    order.forEach((name, at) => {
      const suffix = at === 0 ? '' : `-${at}`;

      expect(page).toContain(
        `## \`${name}\`\n\n*function* - [Declaration](/references/api/x-kit--part-1#applicationenvironment${suffix})`,
      );
    });
  });

  test('every name gets the anchor the site makes of it, numbered past one already taken', () => {
    const huge = record({
      name: 'zz',
      declaration: `export declare const zz: '${'z'.repeat(ApiReference.MAX_PAGE_CHARS)}';`,
    });
    const odd = [
      '_foo',
      'foo',
      'foo_1',
      'MAX_PAGE_SIZE',
      '$state',
      '__esModule__',
      'a$$b_',
      '_9lives',
    ];
    const split = ApiReference.filesOf({ records: [...odd.map((name) => record({ name })), huge] });
    const page = split.get('x-kit.md') ?? '';
    const anchorOf = (name: string): string | undefined =>
      page
        .split(`## \`${name}\`\n\n*function* - [Declaration](/references/api/x-kit--part-1`)[1]
        ?.split(')')[0];

    // Lower case, a run of marks is one dash, none at an end, `_` before a digit, and `-1` past an anchor taken.
    expect(odd.map((name) => [name, anchorOf(name)])).toEqual([
      ['_foo', '#foo'],
      ['foo', '#foo-1'],
      ['foo_1', '#foo-1-1'],
      ['MAX_PAGE_SIZE', '#max-page-size'],
      ['$state', '#state'],
      ['__esModule__', '#esmodule'],
      ['a$$b_', '#a-b'],
      ['_9lives', '#_9lives'],
    ]);
  });

  test('the entry page of a very large entry grows past the limit, with a heading for each export and no code', () => {
    const many = Array.from({ length: 600 }, (_, at) => `someLongerExportName${at}`);
    const split = ApiReference.filesOf({ records: many.map(long) });
    const page = split.get('x-kit.md') ?? '';

    expect(page.length).toBeGreaterThan(ApiReference.MAX_PAGE_CHARS);
    expect([...page.matchAll(/^## `/gm)]).toHaveLength(600);
    expect(page).not.toContain('```');

    for (const [file, text] of split) {
      if (file.includes('--part-')) {
        expect(text.length).toBeLessThanOrEqual(ApiReference.MAX_PAGE_CHARS);
      }
    }
  });

  test('a name outside ASCII is listed and linked to its part', () => {
    const split = ApiReference.filesOf({
      records: [...Array.from({ length: 12 }, (_, at) => long(`value${at}`)), long('đếm')],
    });
    const page = split.get('x-kit.md') ?? '';
    const link =
      /## `đếm`\n\n\*function\* - \[Declaration\]\(\/references\/api\/(x-kit--part-\d)#đem\)/.exec(
        page,
      )?.[1];

    expect(split.get(`${link}.md`)).toContain('const đếm:');
  });

  test('a subpath named like a part gets files of its own', () => {
    const split = ApiReference.filesOf({
      records: [
        ...names.map(long),
        record({ name: 'other', specifier: '@x/kit/part-1', subpath: './part-1' }),
      ],
    });

    expect(split.get('x-kit-part-1.md')).toContain('# `@x/kit/part-1`');
    expect(split.get('x-kit--part-1.md')).toContain('# `@x/kit (1 of 3)`');
  });

  test('one export over the limit has a part of its own', () => {
    const huge = record({
      name: 'huge',
      declaration: `export declare const huge: '${'y'.repeat(ApiReference.MAX_PAGE_CHARS)}';`,
    });
    const split = ApiReference.filesOf({ records: [huge, long('small')] });

    expect([...split.keys()].sort()).toEqual([
      'index.md',
      'x-kit--part-1.md',
      'x-kit--part-2.md',
      'x-kit.md',
    ]);
  });
});

describe('ApiReference.filesOf', () => {
  const records = [
    record({
      name: 'zeta',
      doc: 'The last one.',
      declaration: '/** The last one. */\nexport declare function zeta(): void;',
    }),
    record({ name: 'alpha' }),
    record({ name: 'run', specifier: '@x/kit/testing', subpath: './testing', doc: 'Runs.' }),
  ];
  const files = ApiReference.filesOf({ records });

  test('one page for each entry, plus an index', () => {
    expect([...files.keys()].sort()).toEqual(['index.md', 'x-kit-testing.md', 'x-kit.md']);
  });

  test('a page lists the exports by name, with category, TSDoc and the declaration without its leading comment', () => {
    const page = files.get('x-kit.md') ?? '';

    expect(page.indexOf('## `alpha`')).toBeLessThan(page.indexOf('## `zeta`'));
    expect(page).toContain('*function*');
    expect(page).toContain('The last one.\n');
    expect(page).toContain('```ts\nexport declare function zeta(): void;\n```');
    expect(page).not.toContain('/** The last one. */');
    expect(page).toContain('Source: `packages/kit/src/index.ts`');
    expect(page).not.toContain('index.ts:3');
  });

  test('the exports without TSDoc are counted and named at the top', () => {
    const page = files.get('x-kit.md') ?? '';

    expect(page).toContain('2 exports, 1 with TSDoc.');
    expect(page).toContain('Without TSDoc (1): `alpha`.');
  });

  test('the index links each page with its counts', () => {
    const index = files.get('index.md') ?? '';

    expect(index).toContain('| [`@x/kit`](/references/api/x-kit) | 2 | 1 |');
    expect(index).toContain('| [`@x/kit/testing`](/references/api/x-kit-testing) | 1 | 1 |');
  });

  test('a re-export of a third-party declaration shows its signature, no source path, and is not counted undocumented', () => {
    const page =
      ApiReference.filesOf({
        records: [record({ name: 'z', external: true, declaration: undefined, doc: undefined })],
      }).get('x-kit.md') ?? '';

    expect(page).toContain('z(): void');
    expect(page).not.toContain('Source:');
    expect(page).not.toContain('Without TSDoc');
  });
});

describe('an export is listed once, on the entry that declares it', () => {
  const at = (opts: {
    name: string;
    specifier: string;
    package: string;
    file: string;
    line?: number;
  }) => record({ subpath: '.', line: 7, ...opts });
  const PACKAGES = [
    { name: '@x/core', path: 'packages/core' },
    { name: '@x/all', path: 'packages/all' },
  ];
  const records = [
    at({
      name: 'Door',
      specifier: '@x/core',
      package: '@x/core',
      file: 'packages/core/src/door.ts',
    }),
    at({
      name: 'Door',
      specifier: '@x/core/doors',
      package: '@x/core',
      file: 'packages/core/src/door.ts',
    }),
    at({ name: 'Door', specifier: '@x/all', package: '@x/all', file: 'packages/core/src/door.ts' }),
    at({ name: 'Own', specifier: '@x/all', package: '@x/all', file: 'packages/all/src/own.ts' }),
  ];

  test('the home is the most specific entry of the package that owns the file', () => {
    const homes = ApiReference.homesOf({ records, packages: PACKAGES });

    expect([...homes.values()].filter((home) => home === '@x/core/doors')).toHaveLength(3);
  });

  test('the home entry has the section; the others name it in one line and repeat nothing', () => {
    const files = ApiReference.filesOf({ records, packages: PACKAGES });
    const home = files.get('x-core-doors.md') ?? '';
    const root = files.get('x-core.md') ?? '';
    const umbrella = files.get('x-all.md') ?? '';

    expect(home).toContain('## `Door`');
    expect(root).not.toContain('## `Door`');
    expect(root).toContain('- `Door` from [`@x/core/doors`](/references/api/x-core-doors)');
    expect(umbrella).toContain('## `Own`');
    expect(umbrella).toContain('- `Door` from [`@x/core/doors`](/references/api/x-core-doors)');
    expect(umbrella.split('export declare function Door').length).toBe(1);
  });

  test('an export is counted and checked for TSDoc once, on its home', () => {
    const gaps = ApiReference.undocumentedOf({ records, packages: PACKAGES });

    expect(gaps).toEqual([
      { specifier: '@x/all', names: ['Own'] },
      { specifier: '@x/core/doors', names: ['Door'] },
    ]);
  });

  test('without the packages, the longest specifier is the home', () => {
    const homes = ApiReference.homesOf({ records });

    expect(new Set(homes.values())).toEqual(new Set(['@x/core/doors', '@x/all']));
  });

  test('two declarations of one name at different lines stay two exports', () => {
    const pair = [
      at({
        name: 'f',
        specifier: '@x/core',
        package: '@x/core',
        file: 'packages/core/src/f.ts',
        line: 1,
      }),
      at({
        name: 'f',
        specifier: '@x/core',
        package: '@x/core',
        file: 'packages/core/src/f.ts',
        line: 9,
      }),
    ];

    expect(ApiReference.pagesOf({ records: pair, packages: PACKAGES })[0].total).toBe(2);
  });
});

describe('the front matter of a page', () => {
  test('a scoped package name is valid YAML: the loader reads the page, it does not skip it', () => {
    const files = ApiReference.filesOf({ records: [record({ name: 'a' })] });
    const page = CorpusFrontmatter.parse({ text: files.get('x-kit.md') ?? '', path: 'x-kit.md' });
    const index = CorpusFrontmatter.parse({ text: files.get('index.md') ?? '', path: 'index.md' });

    expect(page.data.title).toBe('@x/kit');
    expect(page.data.description).toBe(
      'Every export of @x/kit, from the built declarations (generated).',
    );
    expect(index.data.title).toBe('API reference');
  });
});

describe('ApiReference.undocumentedOf', () => {
  test('names the exports with a declaration and no TSDoc, by entry; internal, external and documented ones are not', () => {
    const gaps = ApiReference.undocumentedOf({
      records: [
        record({ name: 'bare' }),
        record({ name: 'known', doc: 'Known.' }),
        record({ name: 'hidden', doc: '@internal' }),
        record({ name: 'third', external: true, declaration: undefined }),
        record({ name: 'ns', category: 'namespace', declaration: undefined }),
        record({ name: 'other', specifier: '@x/kit/testing', subpath: './testing' }),
      ],
    });

    expect(gaps).toEqual([
      { specifier: '@x/kit', names: ['bare'] },
      { specifier: '@x/kit/testing', names: ['other'] },
    ]);
  });
});

describe('ApiReference.isInternal', () => {
  test('an export whose TSDoc says @internal is left out of its page and its counts', () => {
    const files = ApiReference.filesOf({
      records: [
        record({ name: 'shown', doc: 'Public.' }),
        record({ name: 'hidden', doc: '@internal' }),
        record({ name: 'alsoHidden', doc: 'Used by the tests.\n\n@internal' }),
      ],
    });
    const page = files.get('x-kit.md') ?? '';

    expect(page).toContain('## `shown`');
    expect(page).not.toContain('hidden');
    expect(page).not.toContain('alsoHidden');
    expect(page).toContain('1 exports, 1 with TSDoc.');
  });

  test('a word that only contains the tag is not the tag', () => {
    expect(
      ApiReference.isInternal({ record: record({ name: 'x', doc: 'See user@internal.example.' }) }),
    ).toBe(false);
  });
});

describe('ApiReference.proseOf', () => {
  test('markup the comment did not mean is escaped outside code', () => {
    expect(ApiReference.proseOf({ text: 'A <Entity> and {{ x }}.' })).toBe(
      'A &lt;Entity> and &#123;&#123; x }}.',
    );
  });

  test('inline code and fenced examples are left alone', () => {
    const text = 'Use `Promise<T>` here.\n```ts\nconst a = <T,>(x: T) => x;\n```\nThen <b>.';

    expect(ApiReference.proseOf({ text })).toBe(
      'Use `Promise<T>` here.\n```ts\nconst a = <T,>(x: T) => x;\n```\nThen &lt;b>.',
    );
  });
});

describe('the tags of an export in its prose', () => {
  test('@example is a label above its fence, @default and @deprecated are labelled lines', () => {
    const text = [
      'Runs it.',
      '',
      '@default 5',
      '@deprecated use run2',
      '@example',
      '```ts',
      'run();',
      '```',
    ].join('\n');

    expect(ApiReference.proseOf({ text })).toBe(
      [
        'Runs it.',
        '',
        '**Default:** 5',
        '**Deprecated:** use run2',
        '**Example**',
        '```ts',
        'run();',
        '```',
      ].join('\n'),
    );
  });

  test('a tag inside a fence or a code span is left alone, and so is a tag-like word', () => {
    const text = ['Use `@example` here.', '```ts', '@example', '```', 'mail user@example.com'].join(
      '\n',
    );

    expect(ApiReference.proseOf({ text })).toBe(text);
  });
});

describe('ApiReference.fenceOf', () => {
  test('is three backticks, or one more than the longest run in the text', () => {
    expect(ApiReference.fenceOf({ text: 'plain' })).toBe('```');
    expect(ApiReference.fenceOf({ text: 'a ```` b' })).toBe('`````');
  });

  test('a declaration whose member comment holds a fence is wrapped in a longer one', () => {
    const declaration =
      'export declare class F {\n    /** ```ts\n    x\n    ``` */\n    m(): void;\n}';
    const page =
      ApiReference.filesOf({ records: [record({ name: 'F', declaration })] }).get('x-kit.md') ?? '';

    expect(page).toContain('````ts');
  });
});

describe('ApiReference.staleOf', () => {
  const directory = (): string => {
    const root = mkdtempSync(join(tmpdir(), 'atlas-api-'));

    roots.push(root);
    mkdirSync(join(root, 'api'));

    return join(root, 'api');
  };
  const expected = new Map([
    ['a.md', 'one'],
    ['index.md', 'two'],
  ]);

  test('fresh when every file is there and equal and nothing else is', () => {
    const dir = directory();

    writeFileSync(join(dir, 'a.md'), 'one');
    writeFileSync(join(dir, 'index.md'), 'two');

    expect(ApiReference.staleOf({ expected, directory: dir })).toEqual([]);
  });

  test('names a missing file, a changed one and one that is no longer generated', () => {
    const dir = directory();

    writeFileSync(join(dir, 'a.md'), 'changed');
    writeFileSync(
      join(dir, 'gone.md'),
      ApiReference.filesOf({ records: [record({ name: 'x' })] }).get('x-kit.md') ?? '',
    );

    expect(ApiReference.staleOf({ expected, directory: dir })).toEqual([
      'a.md',
      'gone.md',
      'index.md',
    ]);
  });

  test('a page someone wrote by hand in the same folder is neither stale nor removed', () => {
    const dir = directory();

    writeFileSync(
      join(dir, 'a.md'),
      ApiReference.filesOf({ records: [record({ name: 'x' })] }).get('x-kit.md') ?? '',
    );
    writeFileSync(join(dir, 'guide.md'), '# My own page\n');

    const hand = new Map([['a.md', readFileSync(join(dir, 'a.md'), 'utf8')]]);

    expect(ApiReference.staleOf({ expected: hand, directory: dir })).toEqual([]);
  });

  test('a generated page of an entry that is gone is named', () => {
    const dir = directory();
    const old = ApiReference.filesOf({ records: [record({ name: 'x' })] }).get('x-kit.md') ?? '';

    writeFileSync(join(dir, 'gone.md'), old);

    expect(ApiReference.staleOf({ expected: new Map(), directory: dir })).toEqual(['gone.md']);
  });

  test('the parts an entry no longer needs are named, which is what gen removes', () => {
    const dir = directory();
    const declaration = `export declare const big: '${'z'.repeat(ApiReference.MAX_PAGE_CHARS)}';`;
    const long = ApiReference.filesOf({ records: [record({ name: 'big', declaration })] });

    for (const [name, text] of long) {
      writeFileSync(join(dir, name), text);
    }

    const short = ApiReference.filesOf({ records: [record({ name: 'big' })] });

    expect(ApiReference.staleOf({ expected: short, directory: dir })).toEqual([
      'x-kit--part-1.md',
      'x-kit.md',
    ]);
  });

  test('a directory that does not exist yet is all missing', () => {
    expect(ApiReference.staleOf({ expected, directory: join(directory(), 'absent') })).toEqual([
      'a.md',
      'index.md',
    ]);
  });
});
