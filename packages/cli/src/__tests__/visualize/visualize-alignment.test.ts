import { afterAll, describe, expect, test } from 'bun:test';
import { SpecPage } from '../../visualize/index.ts';
import { GROUPS, MEASURE } from './alignment.groups.ts';
import { alignmentSpec } from './alignment.fixture.ts';
import { architectureSpec } from './architecture.fixture.ts';
import { figuresSpec } from './figures.fixture.ts';
import { BrowserPage } from './browser.helper.ts';

/**
 * Repeated cards share their rows. Measured in a real browser, on a page built to break alignment (a badge on one
 * card only, a label that wraps, a title of three lines, lists of different length): for every repeated structure, the
 * same part of every card in one visual row has the same top, at 1280 and at 390 px, in light and in dark. A CSS review
 * cannot see a wrapped label shift a row; this can.
 *
 * It needs Chrome or Chromium. Without one the measuring tests are skipped and the last test says so; set
 * VULCAN_BROWSER_TMPDIR to a short folder when the browser says its socket path is too long.
 */
const html = ((): string => {
  const result = SpecPage.renderText({ text: JSON.stringify(alignmentSpec()) });

  if (!result.ok) {
    throw new Error(result.problems.join('; '));
  }

  return result.page.html;
})();

const hasBrowser = await BrowserPage.available();

afterAll(() => BrowserPage.close());

describe.skipIf(!hasBrowser)('repeated cards share their rows (measured in a browser)', () => {
  for (const width of [1280, 390]) {
    for (const dark of [false, true]) {
      test(`${width} px, ${dark ? 'dark' : 'light'}: the same part of every card has the same top`, async () => {
        const found = await BrowserPage.measure<unknown[]>({
          html,
          width,
          dark,
          expression: `${MEASURE}${JSON.stringify(GROUPS)})`,
        });

        expect(found).toEqual([]);
      });
    }
  }

  test('390 px: nothing makes the page scroll sideways', async () => {
    const overflow = await BrowserPage.measure<number>({
      html,
      width: 390,
      dark: false,
      expression: 'document.documentElement.scrollWidth - window.innerWidth',
    });

    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('the measuring would catch a shifted card: a badge pushed into one card moves its score', async () => {
    // The check itself is checked: the same page with the badge slot taken out of the recommended card must fail.
    const broken = html
      .replace(/<span class="tag-slot"[^>]*>(?:<span class="tag">[^<]*<\/span>)?<\/span>/g, '')
      .replace(
        /<article class="opt rec( sp\d+)">/,
        '<article class="opt rec$1"><span class="tag">x</span>',
      );
    const found = await BrowserPage.measure<{ group: string }[]>({
      html: broken,
      width: 1280,
      dark: false,
      expression: `${MEASURE}${JSON.stringify(GROUPS)})`,
    });

    expect(found.some((entry) => entry.group === 'comparison cards')).toBe(true);
  });
});

describe.skipIf(hasBrowser)('no browser here', () => {
  test('the alignment measuring was skipped: install Chrome or Chromium to run it', () => {
    console.warn(
      'visualize-alignment: no Chrome or Chromium could be started, the layout measuring was skipped',
    );
    expect(hasBrowser).toBe(false);
  });
});

/**
 * Figures hold their text. Measured in a real browser, on a page of long Vietnamese labels: no text of a box sticks
 * out of its box, no arrow label touches a box, and no figure scrolls sideways inside its frame, at 1280 and at 1440 px
 * (below that the figure gives way to its list).
 */
const figuresHtml = ((): string => {
  const result = SpecPage.renderText({ text: JSON.stringify(figuresSpec()) });

  if (!result.ok) {
    throw new Error(result.problems.join('; '));
  }

  return result.page.html;
})();

const FIGURES = `(() => {
  const visible = (el) => el.getClientRects().length > 0;
  const issues = [];
  const nodes = [...document.querySelectorAll('.fig svg .node')].filter(visible);
  const rects = nodes.map((node) => ({ id: node.dataset.node, box: node.querySelector('rect').getBBox() }));

  for (const node of nodes) {
    const rect = node.querySelector('rect').getBBox();

    for (const text of node.querySelectorAll('text')) {
      const box = text.getBBox();

      if (box.x < rect.x + 2 || box.x + box.width > rect.x + rect.width - 2 || box.y < rect.y || box.y + box.height > rect.y + rect.height) {
        issues.push('box text outside its box: ' + text.textContent);
      }
    }
  }

  for (const label of [...document.querySelectorAll('.fig svg .edge text')].filter(visible)) {
    const box = label.getBBox();

    for (const { id, box: rect } of rects) {
      if (box.x < rect.x + rect.width + 2 && box.x + box.width > rect.x - 2 && box.y < rect.y + rect.height + 2 && box.y + box.height > rect.y - 2) {
        issues.push('arrow label over a box: ' + label.textContent + ' / ' + id);
      }
    }
  }

  for (const frame of [...document.querySelectorAll('.fig')].filter(visible)) {
    if (frame.scrollWidth > frame.clientWidth + 1) {
      issues.push('a figure scrolls sideways inside its frame: ' + frame.className);
    }
  }

  return { figures: [...document.querySelectorAll('.fig')].filter(visible).length, issues };
})()`;

describe.skipIf(!hasBrowser)('figures hold their text (measured in a browser)', () => {
  for (const width of [1280, 1440]) {
    for (const dark of [false, true]) {
      test(`${width} px, ${dark ? 'dark' : 'light'}: no overflow, no label on a box, no sideways scroll`, async () => {
        const found = await BrowserPage.measure<{ figures: number; issues: string[] }>({
          html: figuresHtml,
          width,
          dark,
          expression: FIGURES,
        });

        expect(found.figures).toBeGreaterThanOrEqual(3);
        expect(found.issues).toEqual([]);
      });
    }
  }

  test('the diagrams of one explainer share their left edge', async () => {
    const lefts = await BrowserPage.measure<number[]>({
      html: figuresHtml,
      width: 1280,
      dark: false,
      expression: `[...document.querySelectorAll('.estep .dg .fig svg')].filter((svg) => svg.getClientRects().length > 0).map((svg) => Math.round(svg.getBoundingClientRect().left))`,
    });

    expect(lefts.length).toBe(2);
    expect(new Set(lefts).size).toBe(1);
  });

  test('the check sees a box too narrow for its text, a label on a box, and a figure too wide for its frame', async () => {
    const narrowed = figuresHtml.replace(
      /(<rect x="[\d.]+" y="[\d.]+" width=")[\d.]+(" height="[\d.]+" rx="4"\/>)/,
      '$140$2',
    );
    const moved = figuresHtml.replace(
      /(<g class="edge main" data-edge="b&gt;c"><title>[^<]*<\/title><path d="[^"]*"[^>]*\/><text x=")[\d.]+(")/,
      '$1240$2',
    );
    const wide = figuresHtml.replace('.fig{overflow-x:auto}', '.fig{overflow-x:auto;width:300px}');
    const measure = (page: string) =>
      BrowserPage.measure<{ issues: string[] }>({
        html: page,
        width: 1280,
        dark: false,
        expression: FIGURES,
      });

    const result = await measure(narrowed);
    expect(result.issues.some((issue) => issue.startsWith('box text'))).toBe(true);
    const result2 = await measure(moved);
    expect(result2.issues.some((issue) => issue.startsWith('arrow label'))).toBe(true);
    const result3 = await measure(wide);
    expect(result3.issues.some((issue) => issue.startsWith('a figure scrolls'))).toBe(true);
  });
});

describe.skipIf(!hasBrowser)(
  'a figure too wide for the page gives way to its list (measured in a browser)',
  () => {
    const tooWide = ((): string => {
      const spec = figuresSpec() as {
        flow: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
      };

      spec.flow.nodes.push(
        {
          id: 'f',
          label: 'Người đọc báo cáo cuối cùng',
          sublabel: 'xem kết quả mỗi tuần',
          row: 0,
          col: 4,
          kind: 'actor',
        },
        {
          id: 'g',
          label: 'Kho lưu trữ lâu dài',
          sublabel: 'giữ bản sao một năm',
          row: 0,
          col: 5,
          kind: 'store',
        },
      );
      spec.flow.edges.push(
        { from: 'd', to: 'f', label: 'gửi báo cáo tuần' },
        { from: 'f', to: 'g', label: 'lưu bản sao' },
      );

      const result = SpecPage.renderText({ text: JSON.stringify(spec) });

      if (!result.ok) {
        throw new Error(result.problems.join('; '));
      }

      return result.page.html;
    })();

    for (const width of [1280, 1920]) {
      test(`${width} px: the six-column flow is shown as its list, and nothing scrolls sideways`, async () => {
        const found = await BrowserPage.measure<{ flowVisible: boolean; issues: string[] }>({
          html: tooWide,
          width,
          dark: false,
          expression: `(() => { const flow = document.querySelector('.hero .fig'); const base = ${FIGURES}; return { flowVisible: flow !== null && flow.getClientRects().length > 0, issues: base.issues }; })()`,
        });

        expect(found.flowVisible).toBe(false);
        expect(found.issues).toEqual([]);
      });
    }
  },
);

const architectureHtml = ((): string => {
  const result = SpecPage.renderText({ text: JSON.stringify(architectureSpec()) });

  if (!result.ok) {
    throw new Error(result.problems.join('; '));
  }

  return result.page.html;
})();

/**
 * The architecture figure keeps its lines off the boxes: no point of a link is inside a box, no label sits on a box
 * or on another link, no box text leaves its box, and the figure fits its frame.
 */
const ARCHITECTURE = `(() => {
  const issues = [];
  const visible = (el) => el.getClientRects().length > 0;
  const svg = [...document.querySelectorAll('.fig svg')].find((item) => visible(item) && item.querySelector('.dbox'));

  if (svg === undefined) {
    return { drawn: false, issues };
  }

  const boxes = [...svg.querySelectorAll('.dbox')].map((g) => ({ id: g.dataset.box, rect: g.querySelector('rect').getBBox(), g }));
  const lines = [...svg.querySelectorAll('.dlink')].map((link) => ({ link, path: link.querySelector('path.dline') }));

  for (const { id, rect, g } of boxes) {
    for (const text of g.querySelectorAll('text')) {
      const box = text.getBBox();

      if (box.x < rect.x + 2 || box.x + box.width > rect.x + rect.width - 2 || box.y < rect.y || box.y + box.height > rect.y + rect.height) {
        issues.push('box text outside its box: ' + id + ' ' + text.textContent);
      }
    }
  }

  lines.forEach(({ link, path }, index) => {
    const length = path.getTotalLength();

    for (let at = 0; at <= length; at += 3) {
      const point = path.getPointAtLength(at);
      const inside = boxes.find(({ rect }) => point.x > rect.x + 1 && point.x < rect.x + rect.width - 1 && point.y > rect.y + 1 && point.y < rect.y + rect.height - 1);

      if (inside !== undefined) {
        issues.push('a link runs through box ' + inside.id);
        break;
      }
    }

    const label = link.querySelector('text.dl');

    if (label === null) {
      return;
    }

    const box = label.getBBox();

    for (const { id, rect } of boxes) {
      if (box.x < rect.x + rect.width + 2 && box.x + box.width > rect.x - 2 && box.y < rect.y + rect.height + 2 && box.y + box.height > rect.y - 2) {
        issues.push('link label on box ' + id + ': ' + label.textContent);
      }
    }

    lines.forEach((other, at) => {
      if (at === index) {
        return;
      }

      const total = other.path.getTotalLength();

      for (let step = 0; step <= total; step += 3) {
        const point = other.path.getPointAtLength(step);

        if (point.x > box.x && point.x < box.x + box.width && point.y > box.y && point.y < box.y + box.height) {
          issues.push('link label crossed by another link: ' + label.textContent);
          break;
        }
      }
    });
  });

  const frame = svg.closest('.fig');

  if (frame.scrollWidth > frame.clientWidth + 1) {
    issues.push('the figure scrolls sideways inside its frame');
  }

  return { drawn: true, issues };
})()`;

describe.skipIf(!hasBrowser)(
  'the architecture figure keeps its lines off its boxes (measured in a browser)',
  () => {
    for (const width of [1280, 1440]) {
      for (const dark of [false, true]) {
        test(`${width} px, ${dark ? 'dark' : 'light'}: six boxes in a layer are drawn, and nothing crosses a box or a label`, async () => {
          const found = await BrowserPage.measure<{ drawn: boolean; issues: string[] }>({
            html: architectureHtml,
            width,
            dark,
            expression: ARCHITECTURE,
          });

          expect(found.drawn).toBe(true);
          expect(found.issues).toEqual([]);
        });
      }
    }

    test('the check sees a link through a box, a label on a box, and a box text that sticks out', async () => {
      const measure = (page: string) =>
        BrowserPage.measure<{ issues: string[] }>({
          html: page,
          width: 1280,
          dark: false,
          expression: ARCHITECTURE,
        });
      const through = architectureHtml.replace(
        /(<g class="dlink"><path d=")M[^"]*(" class="dline"\/>)/,
        '$1M0 60L2000 60$2',
      );
      const onBox = architectureHtml.replace(
        /(<text class="dl" x=")[\d.]+(" y=")[\d.]+(")/,
        '$1200$2100$3',
      );
      const narrow = architectureHtml.replace(
        /(<g class="dbox" data-box="w"><rect x="[\d.]+" y="[\d.]+" width=")[\d.]+/,
        '$130',
      );

      const result = await measure(through);
      expect(result.issues.some((issue) => issue.startsWith('a link runs through'))).toBe(true);
      const result2 = await measure(onBox);
      expect(result2.issues.some((issue) => issue.startsWith('link label on box'))).toBe(true);
      const result3 = await measure(narrow);
      expect(result3.issues.some((issue) => issue.startsWith('box text outside'))).toBe(true);
    });
  },
);
