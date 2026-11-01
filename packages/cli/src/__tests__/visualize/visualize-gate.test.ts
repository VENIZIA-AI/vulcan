import { describe, expect, test } from 'bun:test';
import { PageGate } from '../../visualize/gate.ts';
import { renderSpecText } from '../../visualize/index.ts';
import { fullSpec } from './spec.fixture.ts';

const page = (): string => {
  const result = renderSpecText({ text: JSON.stringify(fullSpec()) });

  if (!result.ok) {
    throw new Error(result.problems.join('; '));
  }

  return result.page.html;
};

describe('the output gate', () => {
  test('a page the renderer wrote passes', () => {
    expect(PageGate.problems({ html: page() })).toEqual([]);
  });

  test('a tag that loads something, an inline style, a handler and an address are found', () => {
    const html = page();
    const bad = (extra: string): string[] =>
      PageGate.problems({ html: html.replace('<main>', `<main>${extra}`) });

    expect(bad('<img src="x">').join(' ')).toContain('<img>');
    expect(bad('<div style="color:red"></div>').join(' ')).toContain('attribute style');
    expect(bad('<div onclick="x()"></div>').join(' ')).toContain('attribute onclick');
    expect(bad('<g mask="url(https://127.0.0.1:9/m#m)"></g>').join(' ')).toContain(
      'holds an address',
    );
    expect(bad('<a href="http://x.example">x</a>').join(' ')).toContain('not an https address');
    expect(bad('<script>alert(1)</script>').join(' ')).toContain('3 scripts');
    expect(bad('<style>a{}</style>').join(' ')).toContain('2 style blocks');
    expect(bad('<use href="#a"></use>').join(' ')).toContain('<use>');
  });

  test('an address in the style is found, a marker reference is not', () => {
    const html = page();

    expect(
      PageGate.problems({ html: html.replace('<style>', '<style>@import "x";') }).join(' '),
    ).toContain('the style loads something');
    expect(PageGate.problems({ html })).toEqual([]);
  });

  test('text that looks like markup or an address is only text', () => {
    const result = renderSpecText({
      text: JSON.stringify({
        ...fullSpec(),
        title: 'See https://example.com and <img src=x> and style="a"',
      }),
    });

    expect(result.ok).toBe(true);
  });
});
