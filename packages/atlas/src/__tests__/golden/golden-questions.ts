import { GoldenProjects } from './golden.helper';
import type { IGoldenQuestion } from './golden.helper';

/**
 * The questions agents of consuming apps asked on 2026-11-04, scored against atlas 0.4.10-2: Q1 and Q6 answered,
 * Q2 and Q4 partial, Q3 and Q5 missed. A question is open while `closedBy` names the improvement that answers it;
 * the improvement removes the mark in the same change, because the test fails on an open question that is answered.
 *
 * The facts come from the sources, not from atlas: the kernel's `getDefaultAsyncContextEnabled` table (changelog
 * 2026-08-13), `scope-through.ts`, `assert-application-boots.ts`, `npm view @venizia/ignis@0.4.8-0 dependencies`
 * and the package.json files of ARDOR 0.4.8-1.
 *
 * Q3 and Q7 are the contract of `ScopeThrough.of`: `entity` must have `relationDefinitions: Record<string, { type:
 * string }> | undefined` whose `type` is the literal `'one'` for the relation named. Checked with tsc on 2026-11-05
 * against the kernel's declarations: a static `relationDefinitions` typed `as const`, or annotated with a type alias
 * of the object shape, compiles; `satisfies` (the type widens to `string`), an annotation with an interface (no index
 * signature) and an unannotated literal (widens to `string`) do not.
 */
export const GOLDEN_QUESTIONS: IGoldenQuestion[] = [
  {
    id: 'Q1',
    question: 'What is the asyncContext.enable default for each application class?',
    project: GoldenProjects.IGNIS,
    ask: {
      tool: 'search',
      args: {
        query: 'asyncContext.enable default for the kernel and for ServerApplication',
        limit: 10,
      },
    },
    holds: ['| `getDefaultAsyncContextEnabled()` | `false` | `true` |'],
  },
  {
    id: 'Q2',
    question: 'Does ApplicationBootAssertion.assert run the access boot check?',
    project: GoldenProjects.IGNIS,
    ask: { tool: 'symbol', args: { name: 'ApplicationBootAssertion' } },
    holds: ['every other step and every component runs as in a real boot', 'skipSteps'],
    closedBy: 2,
  },
  {
    id: 'Q3',
    question: 'How can a hand-written entity satisfy ScopeThrough.of?',
    project: GoldenProjects.IGNIS,
    ask: { tool: 'symbol', args: { name: 'ScopeThrough' } },
    holds: ['IEntityWithRelations', 'relationDefinitions: Record<string, {'],
    closedBy: 2,
  },
  {
    id: 'Q4',
    question: 'Which IGNIS packages pin each other exactly?',
    project: GoldenProjects.IGNIS,
    ask: { tool: 'version', args: { cwd: 'packages/core-server' } },
    // Provisional: the shape of the reply is item 3's to decide. `installed` already shows these versions, so the
    // phrase `"requires"` is what tells a pin from an installed version.
    holds: ['"requires"', '"@venizia/ignis-filter":"0.4.7-0"', '"@venizia/ignis-kernel":"0.4.8-0"'],
    closedBy: 3,
  },
  {
    id: 'Q5',
    question: 'What are the peer ranges of ARDOR 0.4.8-1 on IGNIS?',
    project: GoldenProjects.ARDOR,
    ask: { tool: 'version', args: { cwd: 'packages/kernel' } },
    holds: [
      '"requires"',
      '"@venizia/ignis-kernel":"^0.4.8-0"',
      '"@venizia/ignis-filter":"^0.4.7-0"',
    ],
    closedBy: 3,
  },
  {
    id: 'Q6',
    question: 'In which order does a project upgrade VULCAN when the config schema is strict?',
    project: GoldenProjects.VULCAN,
    ask: {
      tool: 'search',
      args: { query: 'strict schema upgrade order config unknown key vulcan sync', limit: 10 },
    },
    holds: [
      'The schema is strict.',
      "Upgrade the project's VULCAN before you record a shared package.",
    ],
  },
  {
    id: 'Q7',
    question: 'Why does ScopeThrough.of refuse a relation written without as const?',
    project: GoldenProjects.IGNIS,
    ask: { tool: 'symbol', args: { name: 'TOneRelationNameOf' } },
    holds: ['typeof RelationTypes.ONE', 'the only ones a child can be scoped through'],
    closedBy: 2,
  },
];
