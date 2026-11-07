import { describe, expect, test } from 'bun:test';
import { VULCAN_CONFIG_SCHEMA } from '../../config/index.ts';

const parse = (guard: unknown) => VULCAN_CONFIG_SCHEMA.safeParse({ guard });
const messageOf = (result: ReturnType<typeof parse>): string =>
  result.success ? '' : result.error.message;

describe('guard.writes.commands and guard.git.askPush', () => {
  test("accept a project's list, and default to nothing", () => {
    const result = parse({
      writes: {
        commands: [
          { rule: 'V-W-02', what: 'running a migration', pattern: '\\bbun run migrate:' },
          { rule: 'V-W-03', what: 'deploying', pattern: '\\bmake deploy-', ignoreCase: true },
        ],
      },
      git: { askPush: ['develop', 'main', 'release/*'] },
    });

    expect(result.success).toBe(true);
    expect(VULCAN_CONFIG_SCHEMA.parse({}).guard.writes.commands).toEqual([]);
    expect(VULCAN_CONFIG_SCHEMA.parse({}).guard.git.askPush).toEqual([]);
    expect(VULCAN_CONFIG_SCHEMA.parse({ guard: { writes: {} } }).guard.git).toEqual({
      askPush: [],
    });
  });

  test('a pattern that is not a regular expression is refused, naming why', () => {
    const result = parse({ writes: { commands: [{ rule: 'V-W-03', what: 'x', pattern: '(' }] } });

    expect(result.success).toBe(false);
    expect(messageOf(result)).toContain('regular expression');
  });

  test.each([
    ['a rule that is not V-W-02 or V-W-03', { rule: 'V-W-01', what: 'x', pattern: 'x' }],
    ['no what', { rule: 'V-W-03', pattern: 'x' }],
    ['an empty pattern', { rule: 'V-W-03', what: 'x', pattern: '' }],
    ['a pattern over 500 characters', { rule: 'V-W-03', what: 'x', pattern: 'a'.repeat(501) }],
    ['a key nobody reads', { rule: 'V-W-03', what: 'x', pattern: 'x', flags: 'g' }],
  ])('%s is refused', (_label, entry) => {
    expect(parse({ writes: { commands: [entry] } }).success).toBe(false);
  });

  test.each([['has space'], [''], ['a;b'], ['$(x)']])(
    'a push target of %j is refused: a branch name and * only',
    (target) => {
      expect(parse({ git: { askPush: [target] } }).success).toBe(false);
    },
  );

  test('a key beside them nobody reads is refused', () => {
    expect(parse({ git: { askPush: [], also: [] } }).success).toBe(false);
  });
});

describe('guard.outside', () => {
  test('defaults to ask, and takes ask or deny', () => {
    expect(VULCAN_CONFIG_SCHEMA.parse({}).guard.outside).toBe('ask');
    expect(VULCAN_CONFIG_SCHEMA.parse({ guard: {} }).guard.outside).toBe('ask');
    expect(parse({ outside: 'ask' }).success).toBe(true);
    expect(VULCAN_CONFIG_SCHEMA.parse({ guard: { outside: 'deny' } }).guard.outside).toBe('deny');
  });

  test('anything else is refused', () => {
    expect(parse({ outside: 'allow' }).success).toBe(false);
    expect(parse({ outside: true }).success).toBe(false);
    expect(parse({ outside: { mode: 'deny' } }).success).toBe(false);
  });
});

describe('remoteHosts was removed', () => {
  test('a config that still sets it is refused with what to do', () => {
    const result = VULCAN_CONFIG_SCHEMA.safeParse({ remoteHosts: { trusted: ['example.test'] } });

    expect(result.success).toBe(false);
    expect(result.success ? '' : result.error.message).toContain(
      '.agents/hooks/trusted-hosts.local',
    );
  });
});
