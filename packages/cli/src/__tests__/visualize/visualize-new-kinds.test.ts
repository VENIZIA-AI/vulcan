import { describe, expect, test } from 'bun:test';
import { DEFAULT_CHROME } from '../../visualize/constants.ts';
import { FIGURE_FIT } from '../../visualize/layout.ts';
import { NEW_KINDS_CSS } from '../../visualize/kinds-css.ts';
import { lifecycleSection, sequenceSection, treeSection } from '../../visualize/kinds-render.ts';
import type { INewKindsContext } from '../../visualize/kinds-render.ts';
import { LIFECYCLE_SCHEMA, SEQUENCE_SCHEMA, TREE_SCHEMA } from '../../visualize/kinds-schema.ts';
import type { ITreeNode } from '../../visualize/kinds-schema.ts';
import { checkNewKinds } from '../../visualize/kinds-validate.ts';
import type { INewKindsSpec } from '../../visualize/kinds-validate.ts';

const sequenceFixture = () => ({
  participants: [
    { id: 'owner', label: 'Owner', sublabel: 'runs the command' },
    { id: 'cli', label: 'Generator' },
    { id: 'disk', label: 'Project folder', sublabel: 'ignored folder' },
  ],
  messages: [
    { from: 'owner', to: 'cli', label: 'run with a spec' },
    { from: 'cli', to: 'disk', label: 'read the spec', note: 'strict JSON' },
    { from: 'disk', to: 'cli', label: 'the text', kind: 'reply' },
    { from: 'cli', to: 'disk', label: 'write the page', kind: 'async' },
    { from: 'cli', to: 'owner', label: 'the path', kind: 'reply' },
  ],
  caption: 'One run, from the command to the written page.',
});

const lifecycleFixture = () => ({
  states: [
    { id: 'draft', label: 'Draft', sublabel: 'on a branch', kind: 'start' },
    { id: 'review', label: 'In review' },
    { id: 'approved', label: 'Approved' },
    { id: 'merged', label: 'Merged', kind: 'end' },
    { id: 'closed', label: 'Closed', kind: 'end' },
  ],
  transitions: [
    { from: 'draft', to: 'review', label: 'open the PR' },
    { from: 'review', to: 'approved', label: 'approve' },
    { from: 'review', to: 'draft', label: 'request changes' },
    { from: 'approved', to: 'merged', label: 'owner merges' },
    { from: 'review', to: 'closed', label: 'close' },
  ],
});

const treeFixture = () => ({
  root: {
    id: 'repo',
    label: 'The repository',
    sublabel: 'one root',
    children: [
      {
        id: 'packages',
        label: 'packages',
        state: 'done',
        children: [
          { id: 'cli', label: 'cli', sublabel: 'the command line', state: 'in progress' },
          { id: 'okf', label: 'okf' },
        ],
      },
      { id: 'docs', label: 'docs', state: 'not started' },
    ],
  },
});

const specOf = (): INewKindsSpec => ({
  sequence: SEQUENCE_SCHEMA.parse(sequenceFixture()),
  lifecycle: LIFECYCLE_SCHEMA.parse(lifecycleFixture()),
  tree: TREE_SCHEMA.parse(treeFixture()),
});

const contextOf = (opts: { spec?: INewKindsSpec; chrome?: INewKindsContext['chrome'] } = {}) => ({
  spec: opts.spec ?? specOf(),
  chrome: opts.chrome ?? DEFAULT_CHROME,
  fits: new Set<number>(),
});

const sections = (opts: { spec?: INewKindsSpec; chrome?: INewKindsContext['chrome'] } = {}) => {
  const ctx = contextOf(opts);

  return {
    ctx,
    sequence: sequenceSection({ ctx }),
    lifecycle: lifecycleSection({ ctx }),
    tree: treeSection({ ctx }),
  };
};

/** The text of some markup in reading order: tags dropped, a space where a tag was. */
const textOf = (html: string): string =>
  html
    .replace(/<title>[\s\S]*?<\/title>/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ');
const figureOf = (html: string): string =>
  /<div class="fig f\d+">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '';
const listOf = (html: string): string =>
  /(<(?:div|ul) class="path kl[\s\S]*?)<figcaption>/.exec(html)?.[1] ?? '';

const parses = (schema: { safeParse: (input: unknown) => { success: boolean } }, input: unknown) =>
  schema.safeParse(input).success;

const tree = (opts: { depth: number; width?: number }): ITreeNode => {
  let node: ITreeNode = { id: 'leaf', label: 'leaf' };

  for (let level = opts.depth; level >= 1; level -= 1) {
    node = { id: `n${level}`, label: `n${level}`, children: [node] };
  }

  return { id: 'root', label: 'root', children: [node] };
};

describe('the schemas', () => {
  test('a good sequence, lifecycle and tree parse', () => {
    expect(parses(SEQUENCE_SCHEMA, sequenceFixture())).toBe(true);
    expect(parses(LIFECYCLE_SCHEMA, lifecycleFixture())).toBe(true);
    expect(parses(TREE_SCHEMA, treeFixture())).toBe(true);
  });

  test('a lifecycle without transitions gets an empty list', () => {
    const parsed = LIFECYCLE_SCHEMA.parse({
      states: [
        { id: 'a', label: 'A', kind: 'start' },
        { id: 'b', label: 'B', kind: 'end' },
      ],
    });

    expect(parsed.transitions).toEqual([]);
  });

  test('an unknown key is an error in every object', () => {
    const sequence = sequenceFixture();
    const lifecycle = lifecycleFixture();
    const root = treeFixture();

    expect(parses(SEQUENCE_SCHEMA, { ...sequence, extra: 1 })).toBe(false);
    expect(
      parses(SEQUENCE_SCHEMA, {
        ...sequence,
        participants: [{ id: 'a', label: 'A', colour: 'red' }, sequence.participants[1]],
      }),
    ).toBe(false);
    expect(
      parses(SEQUENCE_SCHEMA, {
        ...sequence,
        messages: [{ from: 'a', to: 'b', label: 'x', arrow: 'big' }],
      }),
    ).toBe(false);
    expect(parses(LIFECYCLE_SCHEMA, { ...lifecycle, extra: 1 })).toBe(false);
    expect(parses(TREE_SCHEMA, { ...root, extra: 1 })).toBe(false);
    expect(parses(TREE_SCHEMA, { root: { ...root.root, colour: 'red' } })).toBe(false);
  });

  test('the sequence takes 2 to 6 participants and 1 to 20 messages', () => {
    const sequence = sequenceFixture();
    const party = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ id: `p${index}`, label: `P${index}` }));
    const talk = (count: number) =>
      Array.from({ length: count }, () => ({ from: 'p0', to: 'p1', label: 'ask' }));

    expect(parses(SEQUENCE_SCHEMA, { ...sequence, participants: party(1) })).toBe(false);
    expect(
      parses(SEQUENCE_SCHEMA, { ...sequence, participants: party(2), messages: talk(1) }),
    ).toBe(true);
    expect(
      parses(SEQUENCE_SCHEMA, { ...sequence, participants: party(6), messages: talk(20) }),
    ).toBe(true);
    expect(parses(SEQUENCE_SCHEMA, { ...sequence, participants: party(7) })).toBe(false);
    expect(parses(SEQUENCE_SCHEMA, { ...sequence, messages: talk(21) })).toBe(false);
    expect(parses(SEQUENCE_SCHEMA, { ...sequence, messages: [] })).toBe(false);
  });

  test('an arrow label is at most 20 characters and a plain line', () => {
    const sequence = sequenceFixture();
    const message = (label: string) => ({ from: 'owner', to: 'cli', label });

    expect(parses(SEQUENCE_SCHEMA, { ...sequence, messages: [message('x'.repeat(20))] })).toBe(
      true,
    );
    expect(parses(SEQUENCE_SCHEMA, { ...sequence, messages: [message('x'.repeat(21))] })).toBe(
      false,
    );
    expect(parses(SEQUENCE_SCHEMA, { ...sequence, messages: [message('two\nlines')] })).toBe(false);
    expect(parses(SEQUENCE_SCHEMA, { ...sequence, messages: [message('   ')] })).toBe(false);
    expect(parses(SEQUENCE_SCHEMA, { ...sequence, messages: [message('a‮b')] })).toBe(false);

    const lifecycle = lifecycleFixture();

    expect(
      parses(LIFECYCLE_SCHEMA, {
        ...lifecycle,
        transitions: [{ from: 'draft', to: 'review', label: 'x'.repeat(21) }],
      }),
    ).toBe(false);
  });

  test('a message kind, a state kind and a node state come from closed sets', () => {
    const sequence = sequenceFixture();
    const lifecycle = lifecycleFixture();

    expect(
      parses(SEQUENCE_SCHEMA, {
        ...sequence,
        messages: [{ from: 'owner', to: 'cli', label: 'ask', kind: 'shout' }],
      }),
    ).toBe(false);
    expect(
      parses(LIFECYCLE_SCHEMA, {
        ...lifecycle,
        states: [{ id: 'a', label: 'A', kind: 'middle' }, lifecycle.states[1]],
      }),
    ).toBe(false);
    expect(parses(TREE_SCHEMA, { root: { id: 'r', label: 'R', state: 'sleeping' } })).toBe(false);
  });

  test('a lifecycle takes 2 to 10 states and up to 20 transitions', () => {
    const states = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ id: `s${index}`, label: `S${index}` }));
    const moves = (count: number) =>
      Array.from({ length: count }, () => ({ from: 's0', to: 's1', label: 'go' }));

    expect(parses(LIFECYCLE_SCHEMA, { states: states(1) })).toBe(false);
    expect(parses(LIFECYCLE_SCHEMA, { states: states(10), transitions: moves(20) })).toBe(true);
    expect(parses(LIFECYCLE_SCHEMA, { states: states(11) })).toBe(false);
    expect(parses(LIFECYCLE_SCHEMA, { states: states(3), transitions: moves(21) })).toBe(false);
  });

  test('a tree goes four levels below the root and no further', () => {
    expect(parses(TREE_SCHEMA, { root: tree({ depth: 3 }) })).toBe(true);
    expect(parses(TREE_SCHEMA, { root: tree({ depth: 4 }) })).toBe(false);
  });

  test('ids are lowercase letters, digits and a hyphen', () => {
    const sequence = sequenceFixture();

    expect(
      parses(SEQUENCE_SCHEMA, {
        ...sequence,
        participants: [{ id: 'Owner', label: 'O' }, sequence.participants[1]],
      }),
    ).toBe(false);
    expect(parses(TREE_SCHEMA, { root: { id: 'a b', label: 'R' } })).toBe(false);
  });
});

describe('the checks', () => {
  test('a good page has no problems', () => {
    expect(checkNewKinds({ spec: specOf() })).toEqual([]);
    expect(checkNewKinds({ spec: {} })).toEqual([]);
  });

  test('a sequence names an id used twice, an arrow to nowhere and a message to oneself', () => {
    const sequence = SEQUENCE_SCHEMA.parse({
      participants: [
        { id: 'a', label: 'A' },
        { id: 'a', label: 'Again' },
        { id: 'b', label: 'B' },
      ],
      messages: [
        { from: 'a', to: 'ghost', label: 'ask' },
        { from: 'b', to: 'b', label: 'think' },
        { from: 'ghost', to: 'a', label: 'reply' },
      ],
    });
    const problems = checkNewKinds({ spec: { sequence } });

    expect(problems.some((line) => line.includes("id 'a' is used twice"))).toBe(true);
    expect(
      problems.some((line) => line.includes("names 'ghost', which is not a participant")),
    ).toBe(true);
    expect(problems.some((line) => line.includes('to itself'))).toBe(true);
    expect(problems.filter((line) => line.includes('ghost'))).toHaveLength(2);
  });

  const lifecycleProblems = (change: (spec: ReturnType<typeof lifecycleFixture>) => unknown) => {
    const fixture = lifecycleFixture();
    const lifecycle = LIFECYCLE_SCHEMA.parse(change(fixture) ?? fixture);

    return checkNewKinds({ spec: { lifecycle } });
  };

  test('a lifecycle needs exactly one start', () => {
    const two = lifecycleProblems((spec) => {
      spec.states[1] = { id: 'review', label: 'In review', kind: 'start' };
    });
    const none = lifecycleProblems((spec) => {
      spec.states[0] = { id: 'draft', label: 'Draft' };
    });

    expect(
      two.some(
        (line) =>
          line.includes('2 states are of kind') &&
          line.includes("'draft'") &&
          line.includes("'review'"),
      ),
    ).toBe(true);
    expect(none.some((line) => line.includes("no state of kind 'start'"))).toBe(true);
  });

  test('a lifecycle needs an end, and an end has nothing after it', () => {
    const none = lifecycleProblems((spec) => {
      spec.states[3] = { id: 'merged', label: 'Merged' };
      spec.states[4] = { id: 'closed', label: 'Closed' };
    });
    const leaving = lifecycleProblems((spec) => {
      spec.transitions.push({ from: 'merged', to: 'draft', label: 'reopen' });
    });

    expect(none.some((line) => line.includes("no state of kind 'end'"))).toBe(true);
    expect(leaving.some((line) => line.includes("leaves the end state 'merged'"))).toBe(true);
  });

  test('a lifecycle names a state that cannot be reached from the start', () => {
    const problems = lifecycleProblems((spec) => {
      spec.states.push({ id: 'island', label: 'Island' });
    });

    expect(problems).toEqual([
      "lifecycle.states: 'island' cannot be reached from the start 'draft'",
    ]);
  });

  test('a state that is only reached backward is still unreachable', () => {
    const problems = lifecycleProblems((spec) => {
      spec.states.push({ id: 'before', label: 'Before' });
      spec.transitions.push({ from: 'before', to: 'draft', label: 'enter' });
    });

    expect(problems.some((line) => line.includes("'before' cannot be reached"))).toBe(true);
  });

  test('a lifecycle names an id used twice, a transition to nowhere, a loop and a repeat', () => {
    const problems = lifecycleProblems((spec) => {
      spec.states.push({ id: 'review', label: 'Again' });
      spec.transitions.push({ from: 'review', to: 'nowhere', label: 'lost' });
      spec.transitions.push({ from: 'review', to: 'review', label: 'spin' });
      spec.transitions.push({ from: 'draft', to: 'review', label: 'open it again' });
    });

    expect(problems.some((line) => line.includes("id 'review' is used twice"))).toBe(true);
    expect(problems.some((line) => line.includes("names 'nowhere', which is not a state"))).toBe(
      true,
    );
    expect(problems.some((line) => line.includes("'review>review' loops to itself"))).toBe(true);
    expect(problems.some((line) => line.includes("'draft>review' is listed twice"))).toBe(true);
  });

  test('a tree names an id used twice, too many nodes and too many levels', () => {
    const twice = TREE_SCHEMA.parse({
      root: {
        id: 'a',
        label: 'A',
        children: [
          { id: 'b', label: 'B' },
          { id: 'b', label: 'B2' },
        ],
      },
    });

    expect(checkNewKinds({ spec: { tree: twice } })).toEqual(["tree: id 'b' is used twice"]);

    const wide: ITreeNode = {
      id: 'root',
      label: 'root',
      children: Array.from({ length: 5 }, (_, index) => ({
        id: `m${index}`,
        label: `m${index}`,
        children: Array.from({ length: 4 }, (_leaf, leaf) => ({
          id: `l${index}-${leaf}`,
          label: 'l',
        })),
      })),
    };
    const many = checkNewKinds({ spec: { tree: { root: wide } } });

    expect(many).toEqual(['tree: 26 nodes, at most 25 - split it into two trees']);
    expect(checkNewKinds({ spec: { tree: { root: tree({ depth: 4 }) } } })).toEqual([
      'tree: 5 levels below the root, at most 4',
    ]);
  });
});

describe('the figures', () => {
  const kinds = ['sequence', 'lifecycle', 'tree'] as const;

  test('each kind is a section with a figure, a list and a caption', () => {
    const html = sections();

    for (const kind of kinds) {
      expect(html[kind]).toContain(`id="${kind}" data-slide`);
      expect(html[kind]).toContain('<figure class="kfig">');
      expect(html[kind]).toContain('<figcaption>');
      expect(html[kind]).toMatch(/<div class="fig f\d+"><svg class="kf"/);
      expect(html[kind]).toMatch(/class="path kl k/);
    }
  });

  test('each figure is an inline svg with a viewBox and a one-sentence aria-label', () => {
    const html = sections();

    for (const kind of kinds) {
      const svg = figureOf(html[kind]);

      expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 \d+ \d+"/);
      expect(svg).toMatch(/ aria-label="[^"]+"/);
      expect(svg).toContain('role="group"');
      expect(svg.endsWith('</svg>')).toBe(true);
    }
  });

  test('the section titles are the page words', () => {
    const html = sections();

    expect(html.sequence).toContain(`>${DEFAULT_CHROME.sequence}</h2>`);
    expect(html.lifecycle).toContain(`>${DEFAULT_CHROME.lifecycle}</h2>`);
    expect(html.tree).toContain(`>${DEFAULT_CHROME.tree}</h2>`);
  });

  test('the caption is the owner sentence, else the page counts the parts', () => {
    const html = sections();

    expect(html.sequence).toContain(
      '<figcaption>One run, from the command to the written page.</figcaption>',
    );
    expect(html.lifecycle).toContain('<figcaption>5 states, 5 transitions</figcaption>');
    expect(html.tree).toContain('<figcaption>The repository: 5 items</figcaption>');
  });

  test('a section is empty when its kind is absent', () => {
    const html = sections({ spec: {} });

    expect([html.sequence, html.lifecycle, html.tree]).toEqual(['', '', '']);
    expect(html.ctx.fits.size).toBe(0);
  });

  test('every arrow has its verb in the figure and a reply is dashed, an async head is open', () => {
    const html = sections();
    const svg = figureOf(html.sequence);

    for (const verb of [
      'run with a spec',
      'read the spec',
      'the text',
      'write the page',
      'the path',
    ]) {
      expect(svg).toContain(verb);
    }

    expect(svg.match(/class="kline kdash"/g)).toHaveLength(2 + 1);
    expect(svg).toContain('class="kopen"');
    expect(svg.match(/class="kmsg k-reply"/g)).toHaveLength(2);
    expect(svg.match(/class="kmsg k-async"/g)).toHaveLength(1);
  });

  test('the sequence list reads one line per message in order, with its words', () => {
    const list = listOf(sections().sequence);
    const text = textOf(list);

    expect(text.indexOf('run with a spec')).toBeLessThan(text.indexOf('read the spec'));
    expect(text.indexOf('read the spec')).toBeLessThan(text.indexOf('the path'));
    expect(list.match(/<li class="k-/g)).toHaveLength(5);
    expect(text).toContain('reply');
    expect(text).toContain('async');
    expect(text).toContain('strict JSON');
    expect(text).toContain('runs the command');
  });

  test('the lifecycle figure has a start mark, a double border for an end, one box per state', () => {
    const svg = figureOf(sections().lifecycle);

    expect(svg.match(/class="kdot"/g)).toHaveLength(1);
    expect(svg.match(/class="kinner"/g)).toHaveLength(2);
    expect(svg.match(/class="kstate kk-/g)).toHaveLength(5);
    expect(svg).toContain('>start<');
    expect(svg.match(/>end</g)).toHaveLength(2);
  });

  test('the lifecycle list is one line per state with its outgoing transitions', () => {
    const list = listOf(sections().lifecycle);

    expect(list.match(/<li class="kst /g)).toHaveLength(5);
    expect(list.match(/class="kout"/g)).toHaveLength(3);
    expect(textOf(list)).toMatch(/In review[\s\S]*approve[\s\S]*Approved/);
    expect(textOf(list)).toContain('request changes');
  });

  test('the lifecycle starts with the start state and ends with the ends', () => {
    const list = textOf(listOf(sections().lifecycle));

    expect(list.indexOf('Draft')).toBeLessThan(list.indexOf('In review'));
    expect(list.lastIndexOf('Merged')).toBeGreaterThan(list.lastIndexOf('Approved'));
    expect(list.lastIndexOf('Closed')).toBeGreaterThan(list.lastIndexOf('Approved'));
  });

  test('ten states wrap into two rows and every transition is drawn', () => {
    const states = Array.from({ length: 10 }, (_, index) => ({
      id: `s${index}`,
      label: `State ${index}`,
      kind: index === 0 ? 'start' : index === 9 ? 'end' : 'normal',
    }));
    const transitions = [
      ...Array.from({ length: 9 }, (_, index) => ({
        from: `s${index}`,
        to: `s${index + 1}`,
        label: `go ${index}`,
      })),
      { from: 's2', to: 's7', label: 'skip across' },
      { from: 's8', to: 's1', label: 'back up' },
      { from: 's3', to: 's1', label: 'loop back' },
      { from: 's6', to: 's3', label: 'return' },
    ];
    const lifecycle = LIFECYCLE_SCHEMA.parse({ states, transitions });
    const svg = figureOf(sections({ spec: { lifecycle } }).lifecycle);

    expect(checkNewKinds({ spec: { lifecycle } })).toEqual([]);
    expect(svg.match(/class="kstate /g)).toHaveLength(10);
    // 13 transitions and the line into the start state.
    expect(svg.match(/class="kline"/g)).toHaveLength(14);

    for (const move of transitions) {
      expect(svg).toContain(move.label);
    }

    expect(svg).not.toContain('NaN');
    expect(svg).not.toContain('undefined');
  });

  test('two arrows between the same neighbours run on two lines', () => {
    const lifecycle = LIFECYCLE_SCHEMA.parse(lifecycleFixture());
    const svg = figureOf(sections({ spec: { lifecycle } }).lifecycle);
    const horizontals = [...svg.matchAll(/class="kline" d="M(\d+) (\d+)H(\d+)"/g)].map(
      (match) => match[2],
    );

    // draft>review and review>draft sit at two different heights.
    expect(new Set(horizontals.slice(0, 2)).size).toBe(2);
  });

  test('the tree figure is an outline: a box per node, a guide per parent, a mark and a word per state', () => {
    const svg = figureOf(sections().tree);

    expect(svg.match(/class="knode/g)).toHaveLength(5);
    expect(svg.match(/class="kguide"/g)).toHaveLength(2);
    expect(svg.match(/class="kic"/g)).toHaveLength(3);
    expect(svg).toContain('>done<');
    expect(svg).toContain('>in progress<');
    expect(svg).toContain('>not started<');
  });

  test('the tree list is nested, and carries the same text as the figure', () => {
    const html = sections().tree;
    const list = listOf(html);

    expect(list.match(/<ul class="kt-in">/g)).toHaveLength(2);
    expect(list.match(/<li>/g)).toHaveLength(5);

    for (const word of [
      'The repository',
      'one root',
      'packages',
      'cli',
      'the command line',
      'okf',
      'docs',
    ]) {
      expect(figureOf(html)).toContain(word);
      expect(textOf(list)).toContain(word);
    }
  });

  test('for every kind the list carries the text of the figure', () => {
    const html = sections();
    const labels: Record<(typeof kinds)[number], string[]> = {
      sequence: [
        'Owner',
        'Generator',
        'Project folder',
        'runs the command',
        'ignored folder',
        'run with a spec',
        'read the spec',
        'strict JSON',
        'the text',
        'write the page',
        'the path',
      ],
      lifecycle: [
        'Draft',
        'on a branch',
        'In review',
        'Approved',
        'Merged',
        'Closed',
        'open the PR',
        'approve',
        'request changes',
        'owner merges',
        'close',
      ],
      tree: ['The repository', 'packages', 'cli', 'okf', 'docs'],
    };

    for (const kind of kinds) {
      for (const label of labels[kind]) {
        expect(textOf(figureOf(html[kind]))).toContain(label.split(' ')[0] ?? label);
        expect(textOf(listOf(html[kind]))).toContain(label);
      }
    }
  });

  test('a long label wraps in the figure and reads whole', () => {
    const label = 'A rather long state name that needs to be wrapped over lines';
    const lifecycle = LIFECYCLE_SCHEMA.parse({
      states: [
        { id: 'a', label, kind: 'start' },
        { id: 'b', label: 'End', kind: 'end' },
      ],
      transitions: [{ from: 'a', to: 'b', label: 'finish it' }],
    });
    const svg = figureOf(sections({ spec: { lifecycle } }).lifecycle);

    expect(textOf(svg).replace(/\s+/g, ' ')).toContain(label);
  });

  test('a message to a participant that is not drawn is left out, not a crash', () => {
    const sequence = SEQUENCE_SCHEMA.parse({
      participants: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      messages: [
        { from: 'a', to: 'ghost', label: 'lost' },
        { from: 'a', to: 'b', label: 'found' },
      ],
    });
    const svg = figureOf(sections({ spec: { sequence } }).sequence);

    expect(svg).toContain('found');
    expect(svg).not.toContain('lost');
  });

  test('the page words can replace the words of the figures', () => {
    const custom = {
      ...DEFAULT_CHROME,
      kindReply: 'phan hoi',
      stateStart: 'bat dau',
      countStates: 'trang thai',
    };
    const html = sections({ chrome: custom });

    expect(textOf(listOf(html.sequence))).toContain('phan hoi');
    expect(textOf(listOf(html.sequence))).not.toContain(' reply ');
    expect(figureOf(html.lifecycle)).toContain('>bat dau<');
    expect(html.lifecycle).toContain('5 trang thai, 5 transitions');
  });

  test('the output is the same on every run', () => {
    expect(sections().sequence).toBe(sections().sequence);
    expect(sections().lifecycle).toBe(sections().lifecycle);
    expect(sections().tree).toBe(sections().tree);
  });
});

describe('a phone, escaping and no script', () => {
  test('every figure is wide enough that a 390 px screen gets the list, and its width is registered', () => {
    const html = sections();
    const widths = [...html.ctx.fits];

    expect(widths).toHaveLength(3);

    for (const kind of ['sequence', 'lifecycle', 'tree'] as const) {
      const width = Number(/<div class="fig f(\d+)">/.exec(html[kind])?.[1]);

      expect(html.ctx.fits.has(width)).toBe(true);
      expect(Math.ceil(width * FIGURE_FIT) + 66).toBeGreaterThan(390);
      expect(html[kind].indexOf('<div class="fig')).toBeLessThan(
        html[kind].indexOf('class="path kl'),
      );
    }
  });

  test('the smallest specs still give a list on a phone', () => {
    const spec: INewKindsSpec = {
      sequence: SEQUENCE_SCHEMA.parse({
        participants: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
        messages: [{ from: 'a', to: 'b', label: 'ask' }],
      }),
      lifecycle: LIFECYCLE_SCHEMA.parse({
        states: [
          { id: 'a', label: 'A', kind: 'start' },
          { id: 'b', label: 'B', kind: 'end' },
        ],
        transitions: [{ from: 'a', to: 'b', label: 'go' }],
      }),
      tree: TREE_SCHEMA.parse({ root: { id: 'r', label: 'R' } }),
    };
    const ctx = contextOf({ spec });

    sequenceSection({ ctx });
    lifecycleSection({ ctx });
    treeSection({ ctx });

    for (const width of ctx.fits) {
      expect(Math.ceil(width * FIGURE_FIT) + 66).toBeGreaterThan(390);
    }
  });

  const hostile = '<script>alert(1)</script> & "quoted" \'single\'';
  const hostileSpec = (): INewKindsSpec => ({
    sequence: SEQUENCE_SCHEMA.parse({
      participants: [
        { id: 'a', label: hostile, sublabel: hostile },
        { id: 'b', label: 'B' },
      ],
      messages: [{ from: 'a', to: 'b', label: '<b>x</b>', note: hostile }],
      caption: hostile,
    }),
    lifecycle: LIFECYCLE_SCHEMA.parse({
      states: [
        { id: 'a', label: hostile, sublabel: hostile, kind: 'start' },
        { id: 'b', label: '<img src=x onerror=alert(1)>', kind: 'end' },
      ],
      transitions: [{ from: 'a', to: 'b', label: '"><svg>' }],
      caption: hostile,
    }),
    tree: TREE_SCHEMA.parse({
      root: {
        id: 'r',
        label: hostile,
        sublabel: hostile,
        children: [{ id: 'c', label: '</svg><script>1</script>' }],
      },
      caption: hostile,
    }),
  });

  test('every text of the spec is escaped, never markup', () => {
    const html = sections({ spec: hostileSpec() });

    for (const kind of ['sequence', 'lifecycle', 'tree'] as const) {
      expect(html[kind]).not.toContain('<script');
      expect(html[kind]).not.toContain('<img');
      expect(html[kind]).not.toContain('<b>x');
      expect(html[kind]).toContain('&lt;');
      expect(html[kind]).toContain('&quot;');
      expect(html[kind]).toContain('&amp;');
    }

    expect(html.lifecycle).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  test('no inline style, no script and no style inside an svg, no address to load', () => {
    const plain = specOf();

    for (const spec of [plain, hostileSpec()]) {
      const html = sections({ spec });

      for (const kind of ['sequence', 'lifecycle', 'tree'] as const) {
        const svg = figureOf(html[kind]);

        expect(html[kind]).not.toMatch(/\sstyle=/);
        expect(html[kind]).not.toContain('<script');
        expect(html[kind]).not.toContain('<style');
        expect(svg).not.toContain('<foreignObject');
        // Attribute values dropped first: escaped text may say `onerror=` inside a value, a tag may not carry one.
        expect(svg.replace(/"[^"]*"/g, '""')).not.toMatch(/<[^>]*\son[a-z]+=/);
        // No tag carries an address; the hostile text may say anything, but only as escaped text.
        expect(html[kind].replace(/"[^"]*"/g, '""')).not.toMatch(
          /<[^>]*\s(?:href|src|xlink:href|srcset)=/,
        );
        expect(figureOf(html[kind])).not.toContain('<use');

        if (spec === plain) {
          expect(html[kind]).not.toMatch(/https?:|url\(/);
        }
      }
    }
  });

  test('with scripts removed the text is complete, in reading order', () => {
    const html = sections();
    const withoutScripts = (value: string): string =>
      value.replace(/<script[\s\S]*?<\/script>/g, '');

    for (const kind of ['sequence', 'lifecycle', 'tree'] as const) {
      expect(withoutScripts(html[kind])).toBe(html[kind]);
    }

    const list = textOf(html.sequence);

    expect(list.indexOf('Owner')).toBeLessThan(list.indexOf('run with a spec'));
  });

  test('the new classes carry no attribute the page script would need', () => {
    const html = sections();

    for (const kind of ['sequence', 'lifecycle', 'tree'] as const) {
      expect(html[kind]).not.toMatch(/data-(?!slide)/);
    }
  });
});

describe('the stylesheet', () => {
  /** Every token the brief names, and the fixed state names the stylesheet owner defines. */
  const TOKENS = new Set([
    'bg',
    'bg-soft',
    'ink',
    'body',
    'muted',
    'accent',
    'accent-ink',
    'accent-soft',
    'hot',
    'hot-ink',
    'hot-glow',
    'slab',
    'slab-2',
    'slab-3',
    'slab-ink',
    'slab-body',
    'slab-muted',
    'slab-dot',
    'ok',
    'warn',
    'bad',
    'info',
    's1',
    's2',
    's3',
    's4',
    's5',
  ]);

  test('it uses only the tokens of the brief', () => {
    const used = [...NEW_KINDS_CSS.matchAll(/var\(--([a-z0-9-]+)/g)].map((match) => match[1] ?? '');

    expect(used.length).toBeGreaterThan(20);

    for (const name of used) {
      expect(TOKENS.has(name)).toBe(true);
    }
  });

  test('it defines no custom property and no colour of its own', () => {
    expect(NEW_KINDS_CSS).not.toMatch(/--[a-z0-9-]+\s*:/);
    expect(NEW_KINDS_CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(NEW_KINDS_CSS).not.toMatch(/\b(?:rgb|rgba|hsl|hsla|oklch|hwb|lab)\(/);
    expect(NEW_KINDS_CSS.toLowerCase()).not.toMatch(
      /\b(?:red|green|blue|orange|bronze|gold|amber|yellow|purple|pink|white|black)\b/,
    );
  });

  test('it loads nothing and does not move', () => {
    expect(NEW_KINDS_CSS).not.toMatch(/url\(|@import|@font-face|animation|transition|@keyframes/);
  });

  test('it styles every class the figures use', () => {
    const all = sections();
    // Only the figure, its list and its caption: the section frame around them is the page's.
    const html = [all.sequence, all.lifecycle, all.tree]
      .map((part) => part.slice(part.indexOf('<figure')))
      .join('');
    const classes = new Set(
      [...html.matchAll(/class="([^"]+)"/g)].flatMap((match) => (match[1] ?? '').split(/\s+/)),
    );
    // Classes the page stylesheet owns (the swap rule, the frame, the verb chip, the chip) or that only carry meaning.
    const owned = new Set([
      'fig',
      'sec',
      'lab',
      'path',
      'verb',
      'chip',
      'mut',
      'ic',
      'kk-normal',
      'kmsg',
      'klink',
      'klegend',
      'knode',
      'kstate',
      'kst',
      'k-call',
      'k-reply',
      'k-async',
      'kmsgs',
      'ksq',
      'klc',
      'ktr',
      'kl',
      'kv-call',
    ]);

    for (const name of classes) {
      if (owned.has(name) || /^c-|^f\d+$|^kn-|^kk-/.test(name)) {
        continue;
      }

      expect(NEW_KINDS_CSS).toContain(`.${name}`);
    }
  });
});
