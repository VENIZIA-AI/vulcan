/**
 * A page made to break alignment: every repeated structure gets siblings of different content (a badge on one card
 * only, a label that wraps, a title of three lines, one card with no description, lists of different length). The
 * browser test measures this page; nothing here is a real report.
 */
export const alignmentSpec = (): Record<string, unknown> => ({
  schemaVersion: 1,
  title: 'Cards in a row line up whatever they hold',
  status: { state: 'warn' },
  verdict: 'Every repeated card shares its rows, so the eye reads across.',
  strip: {
    healthy:
      'Yes, and a long answer that wraps onto a second line so the two cards differ in height here.',
    blockedBy: 'A short one.',
    changed: 'The rows are shared now.',
    next: 'Check the page at both widths, light and dark.',
  },
  actions: ['Open it at 390 px.', 'Open it at 1280 px.'],
  flow: {
    nodes: [
      { id: 'a', label: 'Ask', row: 0, col: 0 },
      { id: 'b', label: 'Check', row: 0, col: 1, state: 'waiting' },
      { id: 'c', label: 'Save', row: 0, col: 2 },
    ],
    edges: [
      { from: 'a', to: 'b', label: 'asks' },
      { from: 'b', to: 'c', label: 'saves' },
    ],
    steps: [
      { title: 'Ask', note: 'One short note.', nodes: ['a'], edges: [] },
      {
        title: 'A step whose title is long enough to wrap onto a second line',
        note: 'A note that wraps onto a second line in a narrow step panel on the page.',
        nodes: ['a', 'b'],
        edges: ['a>b'],
      },
      { title: 'Save', note: 'Short.', nodes: ['b', 'c'], edges: ['b>c'] },
    ],
  },
  terms: [
    { term: 'Subgrid', meaning: 'A grid that takes its rows from the grid it sits in.' },
    { term: 'A term whose name is long enough to wrap', meaning: 'Short.' },
    {
      term: 'Baseline',
      meaning:
        'The line the text of one card sits on, shared by its neighbours, and a longer explanation that wraps.',
    },
  ],
  minimap: [
    { task: 'Share the rows', status: 'done', note: 'One short note.' },
    {
      task: 'A task whose name wraps onto a second and a third line',
      status: 'in progress',
      note: 'Its note starts under its long name.',
    },
    {
      task: 'Measure',
      status: 'waiting',
      note: 'A note that is long enough to wrap onto several lines in its card so that the notes below the names differ.',
    },
    { task: 'Ship', status: 'not started' },
  ],
  tiles: [
    { value: '21', label: 'Short label', state: 'done' },
    { value: '1,234,567', label: 'A label long enough to wrap onto a second and third line' },
    { value: '7', label: 'Mid label here', state: 'blocked' },
    { value: '100%', label: 'Another one' },
  ],
  comparison: {
    criteria: [
      'Security',
      'A criterion whose label wraps onto a second line in a card',
      'Speed',
      'Simplicity',
      'Cost to run over a year, all in',
    ],
    options: [
      {
        name: 'Central service',
        line: 'Asks on every request, which is simple to reason about.',
        scores: [5, 2, 3, 4, 2],
        pros: ['Always current', 'One place to audit'],
        cons: ['A call per request'],
      },
      {
        name: 'Snapshot at sign-in',
        scores: [4, 5, 4, 3, 5],
        pros: [
          'No call per request',
          'Cheap',
          'Simple to cache and invalidate when roles change in the directory',
        ],
        recommended: true,
        line: 'Computed once, checked many times.',
      },
      {
        name: 'Per route checks scattered through the whole application',
        scores: [3, 4, 5, 5, 4],
        cons: [
          'Rules are scattered',
          'Hard to audit',
          'Easy to forget one route when adding a new one',
        ],
      },
      {
        name: 'Do nothing',
        line: 'Keep today.',
        scores: [1, 1, 1, 5, 5],
        pros: ['No work'],
        cons: ['The problem stays'],
      },
    ],
    note: 'Scores are judgements, 1 to 5.',
  },
  decisionRecord: {
    context: 'Agents rarely load skills when the catalogue is long.',
    options: [
      { name: 'A block', summary: 'In AGENTS.md.' },
      {
        name: 'Descriptions that carry the trigger words inside them',
        summary:
          'Sharper wording that the agent can match without opening the skill, which keeps the budget small.',
        chosen: true,
      },
      { name: 'Both', summary: 'Two places to keep in step.' },
    ],
    decision: 'Sharper descriptions.',
    consequences: ['Twelve skills are reworded.', 'The catalogue stays under budget.'],
  },
  decisions: [
    {
      question: 'Ask again after an upgrade, and say so in the first line of the output?',
      recommended: 'No.',
      changes: 'Nothing is asked unless the form changes.',
    },
    {
      question: 'Keep the digest file?',
      recommended: 'Yes, keep it for one release as a fallback in case the new path fails.',
      changes: 'The size of the project folder.',
    },
  ],
  findings: {
    numbers: [
      { value: '83%', label: 'on Sonnet', state: 'done' },
      { value: '40%', label: 'on Haiku, measured twice because the first run was noisy' },
      { value: '7', label: 'misses' },
    ],
    charts: [
      {
        type: 'bar',
        title: 'Triggered',
        unit: '%',
        labels: ['plan', 'ship', 'review'],
        values: [83, 97, 93],
      },
      {
        type: 'line',
        title: 'Held-out runs over three weeks, same prompts',
        labels: ['1', '2', '3'],
        series: [
          { name: 'plan', values: [5, 7, 7] },
          { name: 'ship', values: [5, 4, 4] },
        ],
      },
      {
        type: 'donut',
        title: 'Winners',
        parts: [
          { label: 'design-and-plan', value: 5 },
          { label: 'no skill', value: 3 },
          { label: 'done', value: 2, state: 'done' },
        ],
      },
    ],
    callouts: [
      { text: 'Decide prompts missed.', state: 'waiting' },
      {
        text: 'A second callout that is much longer than the first so the two differ in height.',
        state: 'blocked',
      },
    ],
  },
  beforeAfter: {
    before: {
      title: 'Before',
      items: [
        { text: 'A refusal, with a long explanation that wraps.', change: 'removed' },
        { text: 'Ten questions.' },
      ],
    },
    after: {
      title: 'After',
      items: [
        { text: 'A refusal before the first question.', change: 'added' },
        { text: 'Ten questions.' },
        { text: 'A saved file.', change: 'added' },
      ],
    },
  },
  ideaMap: {
    center: 'Pick the right skill',
    branches: [
      {
        label: 'Description',
        items: ['Triggers', 'A skip list', 'Examples', 'Counter-examples'],
        note: 'The one source of truth for the choice.',
      },
      { label: 'Catalog', items: ['Budget'] },
      { label: 'Eval', items: ['Near-misses', 'Held out'] },
      { label: 'Routing hub, with a heading that wraps in a narrow column', items: ['Names only'] },
    ],
  },
  timeline: {
    items: [
      {
        date: '2026-10-25',
        title: 'Released',
        text: 'Done, with a sentence that wraps in the narrow column on a phone.',
        state: 'done',
      },
      { date: '2026-10-27', title: 'Measured', state: 'in progress' },
      { date: 'Next', title: 'Release candidate', state: 'not started' },
    ],
  },
  evidence: [
    { claim: 'A symlink is refused', probe: 'test', result: 'passes', label: 'verified' },
    {
      claim: 'A claim with a long sentence that wraps onto a second line in its column',
      probe: 'read of the code and a second look at the neighbouring module',
      result: 'likely',
      label: 'inferred',
    },
  ],
  risks: [
    { risk: 'A hand-edited file', impact: 'doctor warns', fallback: 'reset' },
    {
      risk: 'A very long title that wraps in its column',
      impact: 'the page grows',
      fallback: 'shorten it',
    },
  ],
  log: [
    { date: '2026-10-25', text: 'The ignore check moved first.' },
    { date: '2026-10-26', text: 'A longer line that wraps onto a second line.' },
  ],
  links: [
    { label: 'Reference', href: 'https://example.com/profile' },
    {
      label: 'A link whose label is long enough to wrap in its card',
      href: 'https://example.com/long',
    },
  ],
});
