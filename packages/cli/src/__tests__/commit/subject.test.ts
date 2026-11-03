import { describe, expect, test } from 'bun:test';
import { SubjectShape } from '../../commit/index.ts';

const SHAPE = { pattern: '^(\\[#\\d+\\])+ (feat|fix|docs|chore)(\\([a-z-]+\\))?: .+$' };

const problem = (opts: { message: string; hint?: string }) =>
  SubjectShape.problemOf({ message: opts.message, subject: { ...SHAPE, hint: opts.hint } });

describe('the first line of a message must match the pattern the project gave', () => {
  test('a matching subject has no problem', () => {
    expect(problem({ message: '[#12] fix(sync): a thing\n\nbody\n' })).toBeUndefined();
    expect(problem({ message: '[#12][#13] docs: two issues\n' })).toBeUndefined();
  });

  test('a subject that does not match is reported with line 1 and the hint', () => {
    expect(problem({ message: 'fix the thing\n' })).toEqual({
      line: 1,
      text: 'fix the thing',
      hint: undefined,
    });
    expect(problem({ message: 'fix the thing\n', hint: '[#N] type(scope): subject' })?.hint).toBe(
      '[#N] type(scope): subject',
    );
  });

  test('git comment lines before the subject are not the subject', () => {
    expect(problem({ message: '# a note\n[#12] fix: a thing\n' })).toBeUndefined();
    expect(problem({ message: '# a note\nfix the thing\n' })?.line).toBe(2);
  });

  test('a CRLF message has the same subject, and a diff below a scissors line is not read', () => {
    expect(problem({ message: '[#12] fix: a thing\r\n\r\nbody\r\n' })).toBeUndefined();
    expect(
      problem({
        message: '[#12] fix: a thing\n# ------------------------ >8 ------------------------\n+x\n',
      }),
    ).toBeUndefined();
    expect(
      problem({
        message: '\n# ------------------------ >8 ------------------------\nnot a subject\n',
      }),
    ).toBeUndefined();
  });

  test('an empty message has no subject to check', () => {
    expect(problem({ message: '\n# only comments\n' })).toBeUndefined();
  });
});

describe('subjects git writes itself are not checked', () => {
  const GENERATED = [
    'Merge pull request #5 from x/y',
    "Merge branch 'develop' into x",
    'Revert "[#1] fix: a thing"',
    'fixup! [#1] fix: a thing',
    'squash! [#1] fix: a thing',
    'amend! [#1] fix: a thing',
  ];

  for (const subject of GENERATED) {
    test(`skips: ${subject}`, () => {
      expect(problem({ message: `${subject}\n` })).toBeUndefined();
    });
  }
});

describe('a pattern is checked when the policy is read, not at every commit', () => {
  test('a pattern that is not a regular expression is reported', () => {
    expect(SubjectShape.patternError({ pattern: '(' })).toContain('regular expression');
    expect(SubjectShape.patternError({ pattern: '^ok$' })).toBeUndefined();
  });
});
