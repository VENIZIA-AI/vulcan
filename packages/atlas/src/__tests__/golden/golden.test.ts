import { afterAll, describe, expect, test } from 'bun:test';
import { GOLDEN_QUESTIONS, GoldenImprovements } from './golden-questions';
import { GoldenProjects, GoldenRunner, GoldenVerdicts } from './golden.helper';
import type { IGoldenQuestion, TGoldenVerdict } from './golden.helper';

const FLYWHEEL_SEARCH = { tool: 'search', args: { query: 'flywheel', limit: 10 } };

const acmeQuestion = (opts: Pick<IGoldenQuestion, 'holds' | 'closedBy'>): IGoldenQuestion => ({
  id: 'A1',
  question: 'What does the core package boot?',
  project: GoldenProjects.ACME,
  ask: FLYWHEEL_SEARCH,
  ...opts,
});

describe('golden questions: the mechanism, on the acme fixture', () => {
  test('a question one served text answers is answered', async () => {
    const question = acmeQuestion({ holds: ['boots the flywheel engine'] });

    const result = await GoldenRunner.verdictOf({ question });
    expect(result).toBe(GoldenVerdicts.ANSWERED);
  });

  test('a question marked open, with no text that answers it, stays open', async () => {
    const question = acmeQuestion({
      holds: ['a sentence no page has'],
      closedBy: GoldenImprovements.DECLARATIONS,
    });

    const result = await GoldenRunner.verdictOf({ question });
    expect(result).toBe(GoldenVerdicts.OPEN);
  });

  test('a question marked open that is now answered is stale: the improvement removes the mark', async () => {
    const question = acmeQuestion({
      holds: ['boots the flywheel engine'],
      closedBy: GoldenImprovements.DECLARATIONS,
    });

    const result = await GoldenRunner.verdictOf({ question });
    expect(result).toBe(GoldenVerdicts.STALE_OPEN);
  });

  test('a question not marked open that lost its answer is a regression', async () => {
    const question = acmeQuestion({ holds: ['a sentence no page has'] });

    const result = await GoldenRunner.verdictOf({ question });
    expect(result).toBe(GoldenVerdicts.REGRESSED);
  });

  test('facts spread over two hits are not an answer: one text must hold them all', async () => {
    const question = acmeQuestion({ holds: ['boots the flywheel engine', 'spins faster'] });
    const served = await GoldenRunner.servedOf({ question });

    expect(served.length).toBeGreaterThan(1);
    expect(served.some((text) => text.includes('boots the flywheel engine'))).toBe(true);
    expect(served.some((text) => text.includes('spins faster'))).toBe(true);
    const result = await GoldenRunner.verdictOf({ question });
    expect(result).toBe(GoldenVerdicts.REGRESSED);
  });

  test('a tool that fails makes the question fail loudly', async () => {
    const question: IGoldenQuestion = {
      ...acmeQuestion({ holds: ['x'] }),
      ask: { tool: 'no-such-tool', args: {} },
    };

    const failure = await GoldenRunner.verdictOf({ question }).then(
      () => '',
      (error) => String(error),
    );

    expect(failure).toContain('no-such-tool failed');
  });
});

describe('golden questions: the scoreboard', () => {
  const verdicts = new Map<string, TGoldenVerdict>();

  for (const question of GOLDEN_QUESTIONS) {
    const present = GoldenProjects.isPresent({ project: question.project });

    if (!present) {
      verdicts.set(question.id, GoldenVerdicts.SKIPPED);
    }

    test.skipIf(!present)(`${question.id}: ${question.question}`, async () => {
      const verdict = await GoldenRunner.verdictOf({ question });

      verdicts.set(question.id, verdict);

      // A stale mark and a regression both fail: the list says what atlas serves today, or it says nothing.
      expect([GoldenVerdicts.ANSWERED, GoldenVerdicts.OPEN]).toContain(verdict);
    });
  }

  afterAll(() => {
    const count = (wanted: string): number =>
      [...verdicts.values()].filter((verdict) => verdict === wanted).length;

    console.log(
      `golden questions: ${count(GoldenVerdicts.ANSWERED)} answered, ${count(GoldenVerdicts.OPEN)} open, ` +
        `${count(GoldenVerdicts.SKIPPED)} skipped (no checkout), of ${GOLDEN_QUESTIONS.length}`,
    );
  });
});
