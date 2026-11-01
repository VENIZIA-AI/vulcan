/**
 * What the alignment test measures: the repeated structures of a page (a container, its cards, and the parts of a card
 * that must sit at the same height in every card of a row) and the code run in the page that measures them. Shared by
 * the test and by any script that wants to run the same measuring on a real page.
 */
export interface IGroup {
  name: string;
  /** The container; its items are laid out side by side (mode `rows`) or one under another (mode `column`). */
  container: string;
  item: string;
  slots: string[];
  mode?: 'rows' | 'column';
}

const upTo = (opts: { count: number; make: (index: number) => string }): string[] =>
  Array.from({ length: opts.count }, (_unused, index) => opts.make(index + 1));

export const GROUPS: IGroup[] = [
  {
    name: 'comparison cards',
    container: '#comparison .opts',
    item: '.opt',
    slots: [
      '.tag-slot',
      '.tot',
      'h3',
      '.ln',
      '.crit',
      ...upTo({ count: 8, make: (n) => `.crit > div:nth-child(${n})` }),
      '.proslist',
      ...upTo({ count: 6, make: (n) => `.proslist li:nth-child(${n})` }),
      '.conslist',
      ...upTo({ count: 6, make: (n) => `.conslist li:nth-child(${n})` }),
    ],
  },
  {
    name: 'decision record options',
    container: '#decision-record .opts',
    item: '.opt',
    slots: ['.tag-slot', 'h3', '.ln'],
  },
  { name: 'tiles', container: '.tiles', item: '.tile', slots: ['.n', '.l'] },
  {
    name: 'minimap stepper',
    container: '.strip',
    item: '.seg',
    slots: ['.bar', '.nm', '.tn', '.nt'],
  },
  { name: 'the owner cards', container: '.own', item: ':scope > div', slots: ['.lab'] },
  { name: 'the two facts', container: '.facts', item: '.fact', slots: ['b'] },
  { name: 'charts', container: '.charts', item: 'figure.chart', slots: ['.lab', '.cbody', '.tv'] },
  {
    name: 'before and after',
    container: '.diff',
    item: '.ba',
    slots: ['h3', 'ul', 'li:nth-child(1)', 'li:nth-child(2)'],
  },
  { name: 'idea map branches', container: '.idea', item: '.branch', slots: ['h3', '.chips'] },
  {
    name: 'flow steps',
    container: '.steps',
    item: ':scope > li',
    slots: ['button b', 'button span'],
  },
  { name: 'terms', container: '.terms', item: ':scope > div', slots: ['dt', 'dd'] },
  { name: 'links', container: '.links', item: ':scope > li', slots: ['a'] },
  { name: 'decisions', container: '.qs', item: '.q', slots: ['h3', '.rec'], mode: 'column' },
  {
    name: 'timeline',
    container: '.tl',
    item: ':scope > li',
    slots: ['time', 'h3'],
    mode: 'column',
  },
  {
    name: 'evidence',
    container: '.ledger',
    item: '.ev',
    slots: ['.badge', 'b', '.rs'],
    mode: 'column',
  },
  { name: 'log', container: '.log', item: ':scope > li', slots: ['time'], mode: 'column' },
];

/** The measuring code run in the page: for each group, the spread (in px) of each slot across the items of one visual row (or one column). */
export const MEASURE = `((groups) => {
  const found = [];
  const round = (value) => Math.round(value * 10) / 10;

  for (const group of groups) {
    for (const container of document.querySelectorAll(group.container)) {
      const items = [...container.querySelectorAll(group.item)];
      const bands = [];

      if (group.mode === 'column') {
        bands.push({ items });
      } else {
        for (const item of items) {
          const top = item.getBoundingClientRect().top;
          let band = bands.find((entry) => Math.abs(entry.top - top) < 2);

          if (band === undefined) {
            band = { top, items: [] };
            bands.push(band);
          }

          band.items.push(item);
        }
      }

      for (const band of bands) {
        if (band.items.length < 2) {
          continue;
        }

        if (group.mode !== 'column') {
          const bottoms = band.items.map((item) => item.getBoundingClientRect().bottom);

          if (Math.max(...bottoms) - Math.min(...bottoms) > 1) {
            found.push({ group: group.name, slot: '(the card itself: its bottom)', spread: round(Math.max(...bottoms) - Math.min(...bottoms)) });
          }
        }

        for (const slot of group.slots) {
          const values = band.items
            .map((item) => item.querySelector(slot))
            .filter((element) => element !== null)
            .map((element) => round(group.mode === 'column' ? element.getBoundingClientRect().left : element.getBoundingClientRect().top));

          if (values.length < 2) {
            continue;
          }

          const spread = Math.max(...values) - Math.min(...values);

          if (spread > 1) {
            found.push({ group: group.name, slot, spread: round(spread), values });
          }
        }
      }
    }
  }

  return found;
})(`;
