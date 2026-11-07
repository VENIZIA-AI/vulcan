import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CssVars } from '../css-vars.ts';

const folders: string[] = [];

afterAll(() => {
  for (const folder of folders) {
    rmSync(folder, { recursive: true, force: true });
  }
});

const wiki = (opts: { sheet: string; inline: string }): string => {
  const dist = mkdtempSync(join(tmpdir(), 'css-vars-'));

  folders.push(dist);
  mkdirSync(join(dist, 'assets'));
  writeFileSync(join(dist, 'assets', 'style.css'), opts.sheet);
  writeFileSync(
    join(dist, 'index.html'),
    `<head><link rel="preload stylesheet" href="/assets/style.css" as="style"><link rel="preload stylesheet" href="/assets/style.css" as="style"><style>${opts.inline}</style></head>`,
  );

  return dist;
};

describe('CssVars.read', () => {
  test('the last declaration wins across the sheets and the inline styles, per selector', () => {
    const dist = wiki({
      sheet: '/* a */ :root{--a:1;--b:2}.dark{--a:3}@media (min-width:1px){:root{--c:4}}',
      inline: ':root{--a:5;}.dark{--d:6;}.other{--e:7}',
    });

    expect(CssVars.read({ dist })).toEqual({
      ':root': { '--a': '5', '--b': '2', '--c': '4' },
      '.dark': { '--a': '3', '--d': '6' },
    });
  });

  test('two builds that declare the same values read the same, whatever the order of the names', () => {
    const first = CssVars.read({ dist: wiki({ sheet: ':root{--b:2;--a:1}', inline: '' }) });
    const second = CssVars.read({ dist: wiki({ sheet: ':root{--a:1}', inline: ':root{--b:2}' }) });

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
