import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { commandsOf, runGates } from '../gates.ts';
import type { IGateResult } from '../gates.ts';

const CI = join(import.meta.dir, '..', '..', '..', '.github', 'workflows', 'ci.yml');

const WORKFLOW = `
jobs:
  one:
    steps:
      - name: Install
        run: bun install
      - name: First
        run: make alpha
      - name: Two lines
        run: |
          make beta
          make gamma delta
      - name: Not a gate
        run: echo make nothing
      - name: A uses step
        uses: some/action@v1
  two:
    steps:
      - name: Later
        run: make epsilon zeta
`;

describe('commandsOf reads the gates from the workflow', () => {
  test('the make commands of every job, in the order of the file, one per line, the targets as separate words', () => {
    expect(commandsOf({ text: WORKFLOW })).toEqual([
      { step: 'First', targets: ['alpha'] },
      { step: 'Two lines', targets: ['beta'] },
      { step: 'Two lines', targets: ['gamma', 'delta'] },
      { step: 'Later', targets: ['epsilon', 'zeta'] },
    ]);
  });

  test('a step that is not a make command is not a gate', () => {
    expect(
      commandsOf({ text: WORKFLOW }).map((command) => command.targets.join(' ')),
    ).not.toContain('nothing');
  });
});

describe("CI's own workflow is what make gates runs (drift)", () => {
  const text = readFileSync(CI, 'utf8');

  test('every `make` command written in ci.yml is a gate, none is missed by the reader', () => {
    const written = [...text.matchAll(/^\s*(?:run:\s*)?make ([a-z0-9][a-z0-9 -]*)$/gm)].map(
      (match) => match[1].trim().split(/\s+/),
    );

    expect(commandsOf({ text }).map((command) => command.targets)).toEqual(written);
  });

  test('the checks CI has always held are among them (CI cannot shrink without this test saying so)', () => {
    const targets = commandsOf({ text }).flatMap((command) => command.targets);

    for (const required of [
      'agent-signature-check',
      'catalog-check',
      'okf-check-strict',
      'test-scripts',
      'build',
      'lint-all',
      'test',
      'smoke-cli',
      'smoke-atlas',
    ]) {
      expect(targets).toContain(required);
    }
  });
});

describe("runGates runs them one after another and reports make's own status", () => {
  const commands = [
    { step: 'a', targets: ['one'] },
    { step: 'b', targets: ['two'] },
    { step: 'c', targets: ['three', 'four'] },
  ];
  const fake =
    (opts: { failing?: string; throwing?: string }) =>
    (command: { targets: string[] }): { code: number; tail: string } => {
      if (command.targets[0] === opts.throwing) {
        throw new Error('could not start make');
      }

      return {
        code: command.targets[0] === opts.failing ? 2 : 0,
        tail: command.targets[0] === opts.failing ? 'boom' : '',
      };
    };

  test('all pass: every command ran, in order, and none failed', () => {
    const results = runGates({ commands, run: fake({}), keepGoing: false });

    expect(results.map((result: IGateResult) => [result.step, result.code])).toEqual([
      ['a', 0],
      ['b', 0],
      ['c', 0],
    ]);
  });

  test('the first failure stops the run, with the exit status make gave and its last output', () => {
    const results = runGates({ commands, run: fake({ failing: 'two' }), keepGoing: false });

    expect(results.map((result: IGateResult) => [result.step, result.code])).toEqual([
      ['a', 0],
      ['b', 2],
    ]);
    expect(results[1].tail).toBe('boom');
  });

  test('keep going runs the rest and still reports the failure', () => {
    const results = runGates({ commands, run: fake({ failing: 'two' }), keepGoing: true });

    expect(results.map((result: IGateResult) => result.code)).toEqual([0, 2, 0]);
  });

  test('a make that cannot start is a failure, not a pass', () => {
    const results = runGates({ commands, run: fake({ throwing: 'one' }), keepGoing: false });

    expect(results).toHaveLength(1);
    expect(results[0].code).not.toBe(0);
  });
});
