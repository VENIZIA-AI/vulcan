/** A page that uses every section, for the tests and as the shape the skill documents. */
export const fullSpec = (): Record<string, unknown> => ({
  schemaVersion: 1,
  title: 'The form saves only inside the project',
  status: { state: 'ok' },
  asOf: '2026-10-25',
  scope: 'the profile form',
  verdict: 'Answers go to one ignored file; nothing leaves the project.',
  strip: {
    healthy: 'Yes, the tests pass.',
    blockedBy: 'Nothing.',
    changed: 'The ignore check runs first.',
    next: 'Review the questions.',
  },
  minimap: [
    { task: 'Ignore check', status: 'done' },
    { task: 'Ten questions', status: 'in progress' },
    { task: 'Digest', status: 'not started' },
  ],
  flow: {
    nodes: [
      {
        id: 'user',
        label: 'You',
        sublabel: 'types answers',
        row: 0,
        col: 0,
        type: 'actor',
        detail: 'A person at a terminal.',
      },
      { id: 'form', label: 'The form', sublabel: 'ten questions', row: 0, col: 1, type: 'service' },
      { id: 'check', label: 'Ignore check', row: 0, col: 2 },
      { id: 'file', label: 'profile.json', row: 1, col: 2, type: 'store' },
      { id: 'digest', label: 'Digest', row: 1, col: 0, type: 'external' },
    ],
    edges: [
      { from: 'user', to: 'form', label: 'answers' },
      { from: 'form', to: 'check', label: 'asks' },
      { from: 'check', to: 'file', label: 'saves' },
      { from: 'file', to: 'digest', label: 'feeds', variant: 'branch' },
    ],
    steps: [
      {
        title: 'Ask',
        note: 'The ignore line is checked first.',
        nodes: ['form', 'check'],
        edges: ['form>check'],
      },
      {
        title: 'Save',
        note: 'Then the file is written.',
        nodes: ['check', 'file'],
        edges: ['check>file'],
      },
    ],
  },
  beforeAfter: {
    before: {
      title: 'Before',
      items: [
        { text: 'Ten answers, then a refusal', change: 'removed' },
        { text: 'Saved to a file' },
      ],
    },
    after: {
      title: 'After',
      items: [
        { text: 'A refusal before the first question', change: 'added' },
        { text: 'Saved to a file' },
      ],
    },
  },
  decisions: [
    {
      question: 'Ask again after an upgrade?',
      options: [
        { label: 'No', effect: 'Nothing is asked unless you run the form.', recommended: true },
        { label: 'Yes', effect: 'The form opens after every upgrade.' },
      ],
      why: 'Answers rarely change, and a question nobody asked is noise.',
    },
  ],
  evidence: [{ claim: 'A symlink is refused', probe: 'test', result: 'passes', label: 'verified' }],
  risks: [{ risk: 'A hand-edited file', impact: 'doctor warns', fallback: 'reset' }],
  log: [{ date: '2026-10-25', text: 'The ignore check moved first.' }],
  links: [{ label: 'Reference', href: 'https://example.com/profile' }],
});
