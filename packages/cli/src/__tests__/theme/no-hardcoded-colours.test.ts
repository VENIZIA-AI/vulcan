import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ThemeTokens } from '../../theme/index.ts';

const ROOT = join(import.meta.dir, '../../../../..');
const FOLDERS = [
  'packages/cli/src/board/ui',
  'packages/cli/src/visualize',
  'docs/wiki/site/.vitepress',
];
const SKIPPED = ['__tests__', 'shared', 'node_modules', 'dist', 'cache'];
const SOURCES = /\.(?:ts|tsx|html|css|vue|mts)$/;
const COLOUR = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g;

/** The consumers that still hold colours of their own, each with the colours it may keep. A new colour fails the test; a colour that left a file must leave this list. */
const ALLOWED: { file: string; why: string; colours: string[] }[] = [
  {
    file: 'docs/wiki/site/.vitepress/config.mts',
    why: 'the browser theme-color of the site and the second colour of the product gradient (sienna)',
    colours: ['#c48a5a', '#e8930a'],
  },
  {
    file: 'packages/cli/src/board/ui/components/face.tsx',
    why: "the colours of the agents' faces",
    colours: [
      '#5bb6e8',
      '#8b5a2b',
      '#8e8fa3',
      '#8fd16f',
      '#a0703f',
      '#a9b4bf',
      '#b28de0',
      '#b9783f',
      '#bfe6ff',
      '#ef5b3a',
      '#f28db2',
      '#f5b83d',
      '#f6d33c',
      '#ff8a80',
    ],
  },
  {
    file: 'packages/cli/src/board/ui/shell.html',
    why: 'shadows, hover greys and the error tints of the page shell',
    colours: [
      '#00000026',
      '#00000033',
      '#18181b',
      '#1f1f1f',
      '#3b4cca',
      '#b8706a',
      '#e8a8a0',
      '#f4f4f5',
      '#ffffff33',
    ],
  },
  {
    file: 'packages/cli/src/visualize/assets.ts',
    why: 'the ground-independent state and series colours of a generated page',
    colours: [
      '#0f5c2a',
      '#13261b',
      '#14213a',
      '#157a3a',
      '#164a9e',
      '#199e70',
      '#1baf7a',
      '#1c5ccc',
      '#222222',
      '#2a78d6',
      '#2b2212',
      '#2d1816',
      '#3987e5',
      '#444444',
      '#5a3600',
      '#5fd18a',
      '#7a4504',
      '#7ab0ff',
      '#9a1d17',
      '#9c5a06',
      '#bd2820',
      '#c98500',
      '#d55181',
      '#d95926',
      '#e4f3e8',
      '#e6e6e6',
      '#e6edfb',
      '#e87ba4',
      '#eb6834',
      '#eda100',
      '#f0b955',
      '#f1f1f1',
      '#fbe8e6',
      '#fcefd8',
      '#ff8a80',
      '#ffffff0d',
      '#ffffff14',
      '#ffffff1f',
    ],
  },
  {
    file: 'packages/cli/src/visualize/schema.ts',
    why: 'the default accent of a spec',
    colours: ['#3f5266'],
  },
  {
    file: 'packages/cli/src/visualize/theme.ts',
    why: 'the grounds visualize keeps on its own (not unified with the board and the wiki)',
    colours: [
      '#0b0b0c',
      '#0e0e0f',
      '#151517',
      '#19191b',
      '#1b1b1e',
      '#202023',
      '#252528',
      '#2b2b2f',
      '#3a3a3d',
      '#3f5266',
      '#66666b',
      '#a2a2a8',
      '#d0d0d4',
      '#f5f5f6',
      '#f6f6f5',
      '#f6f6f7',
      '#ffffff14',
    ],
  },
];

const normalise = (colour: string): string => {
  const lower = colour.toLowerCase();

  return lower.length === 4
    ? `#${lower[1]}${lower[1]}${lower[2]}${lower[2]}${lower[3]}${lower[3]}`
    : lower;
};
const walk = (folder: string): string[] =>
  readdirSync(join(ROOT, folder), { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);

    if (SKIPPED.includes(entry.name)) {
      return [];
    }

    return entry.isDirectory() ? walk(path) : SOURCES.test(entry.name) ? [path] : [];
  });
const presetColours = new Set<string>(
  Object.values(ThemeTokens.PRESETS).flatMap((preset) =>
    [preset.light, preset.dark].flatMap((side) =>
      Object.values(side)
        .filter((value) => value.startsWith('#'))
        .map((value) => normalise(value)),
    ),
  ),
);
const coloursOf = (opts: { text: string }): string[] => [
  ...new Set([...opts.text.matchAll(COLOUR)].map((match) => normalise(match[0]))),
];
const strayOf = (opts: { text: string; allowed: string[] }): string[] =>
  coloursOf({ text: opts.text }).filter(
    (colour) => !presetColours.has(colour) && !opts.allowed.includes(colour),
  );
const files = FOLDERS.flatMap((folder) => walk(folder));

describe('a consumer of the design tokens hard-codes no colour that is not a token or listed', () => {
  test('the consumers are found', () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files).toContain('packages/cli/src/board/ui/shell.html');
    expect(files).toContain('packages/cli/src/visualize/theme.ts');
    expect(files).toContain('docs/wiki/site/.vitepress/config.mts');
  });

  test('every colour in a consumer is a value of a preset or is allowed for that file', () => {
    const stray = files.flatMap((file) =>
      strayOf({
        text: readFileSync(join(ROOT, file), 'utf8'),
        allowed: ALLOWED.find((row) => row.file === file)?.colours ?? [],
      }).map((colour) => `${file}: ${colour}`),
    );

    expect(stray).toEqual([]);
  });

  test('a listed colour is still in its file, so the list only shrinks', () => {
    const gone = ALLOWED.flatMap((row) => {
      const present = coloursOf({ text: readFileSync(join(ROOT, row.file), 'utf8') });

      return row.colours
        .filter((colour) => !present.includes(colour))
        .map((colour) => `${row.file}: ${colour}`);
    });

    expect(gone).toEqual([]);
  });

  test('a listed file exists and says why', () => {
    for (const row of ALLOWED) {
      expect(files, row.file).toContain(row.file);
      expect(row.why.length, row.file).toBeGreaterThan(10);
      expect(relative(ROOT, join(ROOT, row.file))).toBe(row.file);
    }
  });

  test('the check sees a new colour, in any spelling', () => {
    expect(strayOf({ text: 'color: #12AB34;', allowed: [] })).toEqual(['#12ab34']);
    expect(strayOf({ text: 'color: #1a3;', allowed: [] })).toEqual(['#11aa33']);
    expect(strayOf({ text: 'color: #12ab3480;', allowed: [] })).toEqual(['#12ab3480']);
    expect(strayOf({ text: 'color: #12ab34;', allowed: ['#12ab34'] })).toEqual([]);
  });
});
