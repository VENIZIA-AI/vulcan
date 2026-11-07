import { describe, expect, test } from 'bun:test';
import { SpecPage } from '../../visualize/index.ts';
import { FigureLayout } from '../../visualize/layout.ts';
import { figuresSpec } from './figures.fixture.ts';

const pageOf = (spec: Record<string, unknown>): string => {
  const result = SpecPage.renderText({ text: JSON.stringify(spec) });

  if (!result.ok) {
    throw new Error(result.problems.join('; '));
  }

  return result.page.html;
};
const nodeOf = (id: string, label = 'x') => ({ id, label, row: 0, col: Number(id.slice(1)) });
const flowOf = (opts: { nodes: ReturnType<typeof nodeOf>[]; label?: string }) => ({
  nodes: opts.nodes,
  edges: opts.nodes.slice(1).map((node, index) => ({
    from: opts.nodes[index]?.id ?? '',
    to: node.id,
    label: opts.label ?? 'go',
  })),
});

describe('the legend of a flow follows the page language', () => {
  const legendOf = (html: string): string =>
    /<ul class="legend">(.*?)<\/ul>/s.exec(html)?.[1] ?? '';

  test('a Vietnamese page names the kinds and the arrows in Vietnamese', () => {
    const legend = legendOf(pageOf(figuresSpec()));
    const words = legend.replace(/<[^>]*>/g, ' ');

    expect(legend).toContain('tác nhân');
    expect(legend).toContain('dịch vụ');
    expect(legend).toContain('kho dữ liệu');
    expect(legend).toContain('lỗi');
    expect(words).not.toMatch(/\b(actor|service|store|error)\b/);
  });

  test('an English page keeps the English words', () => {
    const legend = legendOf(pageOf({ ...figuresSpec(), language: 'en' }));

    expect(legend).toContain('actor');
    expect(legend).toContain('service');
    expect(legend).toContain('store');
  });

  test('the spec can say its own word for a kind', () => {
    const legend = legendOf(
      pageOf({ ...figuresSpec(), chrome: { nodeKinds: { store: 'sổ sách' } } }),
    );

    expect(legend).toContain('sổ sách');
    expect(legend).not.toContain('kho dữ liệu');
  });
});

describe('the figure is sized from its text', () => {
  test('boxes of short labels keep the size they always had, so a short flow is drawn as before', () => {
    const flow = flowOf({ nodes: [nodeOf('n0'), nodeOf('n1'), nodeOf('n2')] });

    // 2 margins of 24, 2 side paddings of 24, three boxes of 176, two gaps of 114.
    expect(FigureLayout.widthOf(flow as never)).toBe(48 + 48 + 3 * 176 + 2 * 114);
  });

  test('a long label wraps inside its box, which grows taller, and never outside it', () => {
    const html = pageOf({
      ...figuresSpec(),
      flow: {
        nodes: [
          {
            id: 'a',
            label: 'Một nhãn rất dài của một hộp trong sơ đồ luồng dữ liệu',
            row: 0,
            col: 0,
          },
          { id: 'b', label: 'Ngắn', row: 0, col: 1 },
        ],
        edges: [{ from: 'a', to: 'b', label: 'gửi' }],
        steps: [],
      },
    });
    const heights = [
      ...html.matchAll(/<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="([\d.]+)" rx="4"\/>/g),
    ].map((match) => Number(match[1]));

    expect(Math.max(...heights)).toBeGreaterThan(60);
    expect(html.match(/class="t">/g)?.length ?? 0).toBeGreaterThan(2);
  });

  test('a wrapped text breaks in balanced lines, not a long one and a lone word', () => {
    const html = pageOf({
      ...figuresSpec(),
      flow: {
        nodes: [
          {
            id: 'a',
            label: 'Cửa hàng B',
            sublabel: 'thấy dữ liệu của người khác nữa',
            row: 0,
            col: 0,
            kind: 'actor',
          },
        ],
        edges: [],
        steps: [],
      },
    });
    const lines = [...html.matchAll(/class="s">([^<]*)</g)].map((match) => match[1] ?? '');

    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.every((line) => line.split(' ').length > 1)).toBe(true);
  });

  test('an arrow label as wide as a line may be widens the gap it sits in, and a short one does not', () => {
    const wide = FigureLayout.widthOf(
      flowOf({ nodes: [nodeOf('n0'), nodeOf('n1')], label: 'abcdefghijklm' }) as never,
    );
    const narrow = FigureLayout.widthOf(
      flowOf({ nodes: [nodeOf('n0'), nodeOf('n1')], label: 'đi' }) as never,
    );

    expect(wide).toBeGreaterThan(narrow);
    expect(narrow).toBe(48 + 48 + 2 * 176 + 114);
  });

  test('the arrow label sits in the gap after its source box, with the lines of a wrapped label stacked', () => {
    const html = pageOf({
      ...figuresSpec(),
      flow: {
        nodes: [nodeOf('n0', 'Một'), nodeOf('n1', 'Hai')],
        edges: [{ from: 'n0', to: 'n1', label: 'gửi organizer o-a ok' }],
        steps: [],
      },
    });

    expect(html).toMatch(
      /<text x="[\d.]+" y="[\d.]+" text-anchor="middle"><tspan x="[\d.]+">[^<]+<\/tspan><tspan x="[\d.]+" dy="16">/,
    );
  });
});

describe('the explainer step diagrams', () => {
  test('a step diagram sits under its text, across the page, and is sized for that space', () => {
    const html = pageOf(figuresSpec());

    expect(html).toContain('.estep .dg{grid-column:2/-1;min-width:0}');
    expect(html).toMatch(/class="fig f\d+i128"/);
  });

  test('the layers list says each layer with its colon attached, and the diagrams share a left edge', () => {
    const html = pageOf(figuresSpec());

    expect(html).toContain('<li><b>Giao diện:</b> Màn hình nhập, Biểu mẫu</li>');
    expect(html).toContain('.estep .dg .fig svg{margin-inline:0}');
    expect(html).toContain('.estep .dg .win{width:fit-content;max-width:100%}');
  });

  test('its row gap fits the arrow labels', () => {
    const html = pageOf(figuresSpec());
    const first = /<g class="dbox"><rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)"/.exec(html);
    const second =
      /<g class="dbox"><rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)"[^>]*\/>.*?<g class="dbox"><rect x="([\d.]+)"/s.exec(
        html,
      );

    expect(Number(second?.[3]) - (Number(second?.[1]) + Number(second?.[2]))).toBeGreaterThan(78);
    expect(first).not.toBeNull();
  });
});
