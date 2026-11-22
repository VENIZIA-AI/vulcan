import { describe, expect, test } from 'bun:test';
import { SpecArchitecture } from '../../visualize/architecture.ts';
import { Assets } from '../../visualize/assets.ts';
import { DEFAULT_CHROME } from '../../visualize/constants.ts';
import { NEW_KINDS_CSS } from '../../visualize/kinds-css.ts';
import { renderSpec } from './render.helper.ts';
import { fullSpec } from './spec.fixture.ts';

const htmlOf = (spec: Record<string, unknown>): string => {
  const result = renderSpec(spec);

  if (!result.ok) {
    throw new Error(result.problems.join('; '));
  }

  return result.page.html;
};
const CHROME = DEFAULT_CHROME;

describe('figure parts are wide, text parts are not', () => {
  test('a part with a figure takes the wide column, the steps and the decisions do not', () => {
    const html = htmlOf(fullSpec());

    expect(html).toMatch(/id="flow" data-slide><div class="wrap fw"><h2 class="sh">/);
    expect(html).toMatch(/id="minimap" data-slide><div class="wrap"><h2 class="sh">/);
    expect(html).toMatch(/id="decisions" data-slide><div class="wrap"><h2 class="sh">/);
  });
});

describe('the figures are light', () => {
  test('no dark window, no dot pattern and no capital micro-label in the style', () => {
    const css = `${Assets.pageCss({ tokens: '' })}${NEW_KINDS_CSS}`;

    expect(css).not.toContain('.win,.pull,.deck{');
    expect(css).not.toContain('radial-gradient');
    expect(css).not.toContain('text-transform:uppercase');
    expect(css).not.toContain('.win,.pull');
    expect(css).not.toContain('var(--hot');
  });

  test('the decision record uses plain headings and flat option cards', () => {
    const html = htmlOf({
      ...fullSpec(),
      decisionRecord: {
        context: 'Why now.',
        options: [
          { name: 'A', summary: 'a', chosen: true },
          { name: 'B', summary: 'b' },
        ],
        decision: 'Choose A.',
        consequences: ['One.'],
      },
    });

    expect(html).toContain('<h3 class="dh">Context</h3>');
    expect(html).toContain('<blockquote class="pull">');
    expect(html).not.toMatch(/<p class="lab">(Context|Decision|Consequences)</);
  });
});

describe('the architecture boxes are ordered to cross the fewest lines', () => {
  test('two layers linked crosswise are drawn straight', () => {
    const drawing = SpecArchitecture.render({
      chrome: CHROME,
      architecture: {
        layers: [
          {
            label: 'Top',
            boxes: [
              { id: 'a1', label: 'Alpha' },
              { id: 'a2', label: 'Beta' },
            ],
          },
          {
            label: 'Bottom',
            boxes: [
              { id: 'b1', label: 'One' },
              { id: 'b2', label: 'Two' },
            ],
          },
        ],
        links: [
          { from: 'a1', to: 'b2' },
          { from: 'a2', to: 'b1' },
        ],
      },
    });

    expect(drawing.svg.indexOf('>Two<')).toBeLessThan(drawing.svg.indexOf('>One<'));
    expect(drawing.svg.indexOf('>Alpha<')).toBeLessThan(drawing.svg.indexOf('>Beta<'));
  });

  test('boxes with no link keep the order the spec gave', () => {
    const drawing = SpecArchitecture.render({
      chrome: CHROME,
      architecture: {
        layers: [
          {
            label: 'Only',
            boxes: [
              { id: 'x', label: 'First' },
              { id: 'y', label: 'Second' },
            ],
          },
        ],
        links: [],
      },
    });

    expect(drawing.svg.indexOf('>First<')).toBeLessThan(drawing.svg.indexOf('>Second<'));
  });
});
