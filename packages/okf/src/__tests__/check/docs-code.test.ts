import { afterAll, afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DocsCodeCheck } from '../../check/docs-code.ts';
import { clearProjectConfig, useProjectConfig } from '../project.helper.ts';

afterEach(clearProjectConfig);

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** A project whose wiki holds `pages`; `wiki` is its content folder, the changelogs live in `wiki/changelogs`. */
const wikiWith = (opts: { pages: Record<string, string>; declared?: boolean }): void => {
  const root = mkdtempSync(join(tmpdir(), 'okf-docs-code-'));

  roots.push(root);

  for (const [path, text] of Object.entries(opts.pages)) {
    mkdirSync(dirname(join(root, 'wiki', path)), { recursive: true });
    writeFileSync(join(root, 'wiki', path), text);
  }

  useProjectConfig({
    root,
    config: {
      knowledge: opts.declared === false ? {} : { wiki: 'wiki', changelogs: 'wiki/changelogs' },
    },
  });
};

const fenced = (opts: { code: string; language?: string }): string =>
  `# Page\n\nText.\n\n\`\`\`${opts.language ?? 'ts'}\n${opts.code}\n\`\`\`\n`;

const problems = (opts: { code: string; language?: string }): string[] => {
  wikiWith({ pages: { 'a.md': fenced(opts) } });

  return DocsCodeCheck.collectProblems();
};

test('an explicit cast is a problem with its file and line, whatever the type', () => {
  for (const code of [
    'const user = value as User;',
    'const user = value as unknown as User;',
    'const x = value as any;',
    'const x = value as never;',
    'const n = value as string;',
    'const n = (await load()) as { id: string };',
    'const list = value as Item[];',
  ]) {
    const found = problems({ code });

    expect(found, code).toHaveLength(1);
    expect(found[0], code).toStartWith('docs-code: wiki/a.md:6: ');
    expect(found[0], code).toContain('cast');
  }
});

test('as const, an import or export alias, a namespace import and `import type` are not casts', () => {
  const code = [
    "import { A as B } from 'x';",
    "import type { C as D } from 'x';",
    "import * as ns from 'x';",
    'export { E as F };',
    "export { G as H } from 'y';",
    "const mode = 'a' as const;",
    "const list = ['a', 'b'] as const;",
  ].join('\n');

  expect(problems({ code })).toEqual([]);
});

test('an `as` in a comment or a string, or in prose, is not a cast', () => {
  expect(
    problems({
      code: '// the value as User is a cast\nconst text = \'works as Foo\';\nconst other = "as unknown as X";\nconst t = `as any`;',
    }),
  ).toEqual([]);
});

test('only ts, tsx, typescript, js, jsx and mts fences are read; bash, json and text are not', () => {
  for (const language of ['bash', 'json', 'text', 'yaml', '']) {
    expect(problems({ code: 'value as User; x: any', language }), language).toEqual([]);
  }

  for (const language of ['ts', 'tsx', 'typescript', 'js', 'jsx', 'mts']) {
    expect(problems({ code: 'const x = value as User;', language }), language).toHaveLength(1);
  }
});

test('any as a type, a conditional spread and a string-literal union are problems', () => {
  for (const [code, word] of [
    ['function f(value: any) {}', 'any'],
    ['const list: any[] = [];', 'any'],
    ['const m = new Map<string, any>();', 'any'],
    ['const options = { ...(flag ? { a: 1 } : {}) };', 'spread'],
    ['const options = { ...(flag && { a: 1 }) };', 'spread'],
    ["type Mode = 'on' | 'off';", 'literal'],
  ]) {
    const found = problems({ code });

    expect(found, code).toHaveLength(1);
    expect(found[0], code).toContain(word);
  }
});

test('the changelogs are not read, and a page outside a fence is not read', () => {
  wikiWith({
    pages: {
      'changelogs/2026-01-01-x.md': fenced({ code: 'const user = value as User;' }),
      'b.md': 'Prose says value as User and `x as Y`.\n',
    },
  });

  expect(DocsCodeCheck.collectProblems()).toEqual([]);
});

test('a nested fence length is respected and a project with no wiki has no problem', () => {
  wikiWith({
    pages: {
      'a.md': '````md\n```ts\nconst x = value as User;\n```\n````\n',
    },
  });

  expect(DocsCodeCheck.collectProblems()).toEqual([]);

  wikiWith({ pages: { 'a.md': fenced({ code: 'const x = value as User;' }) }, declared: false });

  expect(DocsCodeCheck.collectProblems()).toEqual([]);
});

const tableWarnings = (opts: { page: string }): string[] => {
  wikiWith({ pages: { 'a.md': opts.page } });

  return DocsCodeCheck.collectWarnings();
};

test('a table cell over 120 characters is a warning with its file and line; 120 is not', () => {
  const long = 'x'.repeat(121);
  const edge = 'x'.repeat(120);
  const page = `| Name | Meaning |\n|---|---|\n| a | ${edge} |\n| b | ${long} |\n`;
  const found = tableWarnings({ page });

  expect(found).toHaveLength(1);
  expect(found[0]).toStartWith('docs-table: wiki/a.md:4: ');
  expect(found[0]).toContain('121 characters');
});

test('a continuation row with an empty first cell is a warning; an empty header cell and an empty row are not', () => {
  const page = '| Name | Meaning |\n|---|---|\n| a | first |\n|  | second |\n';
  const found = tableWarnings({ page });

  expect(found).toHaveLength(1);
  expect(found[0]).toContain('continuation row');
  expect(tableWarnings({ page: '|  | Meaning |\n|---|---|\n| a | b |\n' })).toEqual([]);
});

test('a table in a code fence and the separator row are not read; an escaped pipe stays in its cell', () => {
  const long = 'x'.repeat(130);

  expect(tableWarnings({ page: `\`\`\`text\n| a | ${long} |\n\`\`\`\n` })).toEqual([]);
  expect(tableWarnings({ page: '| a | b |\n|:---:|---:|\n| `x \\| y` | z |\n' })).toEqual([]);
});

test('an `as` in a template literal, a block or JSDoc comment, or a multi-line string is not a cast', () => {
  const code = [
    'const sql = `SELECT COUNT(*) as total FROM orders`;',
    'const many = `',
    '  SELECT a as b',
    '  FROM t',
    '`;',
    '/**',
    ' * The value as fetched, typed as a User by the caller.',
    ' */',
    '/* value as User */',
    'const ok = 1;',
  ].join('\n');

  expect(problems({ code })).toEqual([]);
});

test('code inside a template expression is still code, and a quote inside a comment does not open a string', () => {
  expect(problems({ code: 'const text = `${value as User}`;' })).toHaveLength(1);
  expect(
    problems({ code: "// it's a comment with an apostrophe\nconst x = value as User;" }),
  ).toHaveLength(1);
});

test('a page the generator owns is not read: its declarations are the source types, not an example', () => {
  const generated = [
    '# Api',
    '',
    '> Generated from the built declarations by `vulcan x atlas api gen` - do not edit.',
    '',
    '```ts',
    'declare function f(value: any): never;',
    'const x = y as Z;',
    '```',
    '',
  ].join('\n');

  wikiWith({
    pages: { 'references/api/a.md': generated, 'b.md': fenced({ code: 'const x = y as Z;' }) },
  });

  const found = DocsCodeCheck.collectProblems();

  expect(found).toHaveLength(1);
  expect(found[0]).toContain('wiki/b.md');
});

test('a region between okf generated markers is not read', () => {
  const page = [
    '<!-- okf:generated:api start -->',
    '```ts',
    'const x = y as Z;',
    '```',
    '<!-- okf:generated:api end -->',
    '',
    '```ts',
    'const w = v as Z;',
    '```',
    '',
  ].join('\n');

  wikiWith({ pages: { 'a.md': page } });

  const found = DocsCodeCheck.collectProblems();

  expect(found).toHaveLength(1);
  expect(found[0]).toContain('wiki/a.md:8');
});

test('docs-code off and on comments leave out what a page quotes from the source, such as a real signature', () => {
  const page = [
    '<!-- docs-code: off -->',
    '```ts',
    'declare function f(value: any): never;',
    '```',
    '<!-- docs-code: on -->',
    '',
    '```ts',
    'const w = v as Z;',
    '```',
    '',
  ].join('\n');

  wikiWith({ pages: { 'a.md': page } });

  const found = DocsCodeCheck.collectProblems();

  expect(found).toHaveLength(1);
  expect(found[0]).toContain('wiki/a.md:8');
});

test('AnyType, the alias of any, is any: in a type position it is a problem, in a name or a string it is not', () => {
  for (const code of [
    'const response: INetworkResponse<AnyType> = load();',
    'function f(value: AnyType) {}',
    'const list: AnyType[] = [];',
    'const m = new Map<string, AnyType>();',
  ]) {
    const found = problems({ code });

    expect(found, code).toHaveLength(1);
    expect(found[0], code).toContain('any');
  }

  expect(
    problems({ code: "const AnyTypeOf = 1;\nconst s = 'AnyType';\nconst x: AnyTypeValue = y;" }),
  ).toEqual([]);
});

const offPage = (opts: { code: string }): string =>
  `<!-- docs-code: off -->\n\`\`\`ts\n${opts.code}\n\`\`\`\n<!-- docs-code: on -->\n`;

test('an off region is counted per page, with its line', () => {
  wikiWith({
    pages: {
      'a.md': `${offPage({ code: 'declare function f(value: any): never;' })}\n${offPage({ code: 'interface IX { run(input: any): void }' })}`,
      'b.md': offPage({ code: 'type T = Record<string, any>;' }),
      'c.md': '# none\n',
    },
  });

  expect(DocsCodeCheck.offRegions()).toEqual([
    { file: 'wiki/a.md', lines: [1, 7] },
    { file: 'wiki/b.md', lines: [1] },
  ]);
  expect(DocsCodeCheck.collectWarnings()).toEqual([]);
});

test('an off region that holds a function body, a call or a statement is a warning: off is for a quoted signature', () => {
  for (const [code, word] of [
    ['function f(value: any) {\n  return value;\n}', 'function body'],
    ['const run = (value: any) => {\n  work(value);\n};', 'function body'],
    ['const result = await load(url);', 'statement'],
    ['const x = build(options);', 'statement'],
    ['return value;', 'statement'],
  ]) {
    wikiWith({ pages: { 'a.md': offPage({ code }) } });

    const found = DocsCodeCheck.collectWarnings();

    expect(found.length, code).toBeGreaterThan(0);
    expect(found[0], code).toStartWith('docs-code: wiki/a.md:');
    expect(found[0], code).toContain('docs-code off');
    expect(found[0], code).toContain(word);
  }
});

test('signatures in an off region are not warned about: declarations, interface members, type aliases, overloads', () => {
  wikiWith({
    pages: {
      'a.md': offPage({
        code: [
          'declare function f(value: any, options?: IOptions): Promise<void>;',
          'interface IService {',
          '  find(filter: any): Promise<IRow[]>;',
          '  readonly name: string;',
          '}',
          'type Handler = (input: any) => void;',
          'class Base {',
          '  run(input: any): void;',
          '}',
        ].join('\n'),
      }),
    },
  });

  expect(DocsCodeCheck.collectWarnings()).toEqual([]);
});
