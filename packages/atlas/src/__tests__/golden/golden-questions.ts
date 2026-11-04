import { GoldenProjects } from './golden.helper';
import type { IGoldenQuestion } from './golden.helper';

/** The improvements that answer a question that is open. */
export class GoldenImprovements {
  static readonly DECLARATIONS = 'symbol serves the declaration with its TSDoc';
  static readonly COMPATIBILITY = 'version serves what a package requires of its neighbours';
}

/**
 * Questions agents of consuming apps ask about a framework. A question is open while `closedBy` names the
 * improvement that answers it; that improvement removes the mark in the same change, because the test fails on an
 * open question that is answered.
 *
 * The facts come from the sources, not from atlas: the kernel's changelog table of `getDefaultAsyncContextEnabled`,
 * `scope-through.ts`, `assert-application-boots.ts`, the published manifest of `@venizia/ignis` and the package.json
 * files of ARDOR.
 *
 * Q3 and Q7 are the contract of `ScopeThrough.of`: `entity` must have `relationDefinitions: Record<string, { type:
 * string }> | undefined` whose `type` is the literal `'one'` for the relation named. Checked with tsc against the
 * kernel's declarations: a static `relationDefinitions` typed `as const`, or annotated with a type alias of the object
 * shape, compiles; `satisfies` (the type widens to `string`), an annotation with an interface (no index signature)
 * and an unannotated literal (widens to `string`) do not.
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
    // The access boot check is the boot step `validateScopeFilterSupport`: the answer must name it beside the rule that
    // every step but the skipped ones runs.
    holds: [
      'every other step and every component runs as in a real boot',
      'skipSteps',
      'validateScopeFilterSupport',
    ],
    closedBy: GoldenImprovements.DECLARATIONS,
  },
  {
    id: 'Q3',
    question: 'How can a hand-written entity satisfy ScopeThrough.of?',
    project: GoldenProjects.IGNIS,
    ask: { tool: 'symbol', args: { name: 'ScopeThrough' } },
    holds: ['IEntityWithRelations', 'relationDefinitions: Record<string, {'],
    closedBy: GoldenImprovements.DECLARATIONS,
  },
  {
    id: 'Q4',
    question: 'Which IGNIS packages pin each other exactly?',
    project: GoldenProjects.IGNIS,
    ask: { tool: 'version', args: { cwd: 'packages/core-server' } },
    // `installed` already names these packages, so `"requires"` is what tells a pin from an installed version.
    holds: ['"requires"', '"@venizia/ignis-filter"', '"@venizia/ignis-kernel"'],
    closedBy: GoldenImprovements.COMPATIBILITY,
  },
  {
    id: 'Q5',
    question: 'What are the peer ranges of ARDOR 0.4.8-1 on IGNIS?',
    project: GoldenProjects.ARDOR,
    ask: { tool: 'version', args: { cwd: 'packages/kernel' } },
    holds: ['"requires"', '"@venizia/ignis-kernel"', '"@venizia/ignis-filter"'],
    closedBy: GoldenImprovements.COMPATIBILITY,
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
    closedBy: GoldenImprovements.DECLARATIONS,
  },
];
