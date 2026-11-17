import { describe, expect, test } from 'bun:test';
import { Assets } from '../../visualize/assets.ts';
import { COMPARE_CSS } from '../../visualize/compare-css.ts';

/** The selectors of the rules that set the code font (`var(--code)`), apart from the definition of the variable itself. */
const codeFontSelectors = (opts: { css: string }): string[] =>
  opts.css
    .split('}')
    .map((rule) => rule.split('{'))
    .filter(
      ([selector, body]) =>
        body?.includes('var(--code)') === true && !(selector ?? '').includes(':root'),
    )
    .map(([selector]) => (selector ?? '').trim());

describe('the code font in a generated page', () => {
  const css = `${Assets.pageCss({ tokens: '' })}${COMPARE_CSS}`;

  test('only real code uses it: inline code and source references', () => {
    expect(codeFontSelectors({ css }).sort()).toEqual(['.src', 'code']);
  });

  test('sentence-type text is set in the text font: the scope line, evidence result, edge labels and dates', () => {
    for (const selector of ['.hero .meta', '.ev .rs', '.verb', '.tl time', '.log time']) {
      const rule = css.split('}').find((item) => item.trim().startsWith(selector));

      expect(rule, selector).toBeDefined();
      expect(rule, selector).toContain('var(--font)');
      expect(rule, selector).not.toContain('var(--code)');
    }
  });
});
