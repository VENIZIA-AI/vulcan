import { describe, expect, test } from 'bun:test';
import { VulcanConfigSchema } from '../../config/index.ts';

const parse = (guard: unknown) => VulcanConfigSchema.safeParse({ guard });
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
    expect(VulcanConfigSchema.parse({}).guard.writes.commands).toEqual([]);
    expect(VulcanConfigSchema.parse({}).guard.git.askPush).toEqual([]);
    expect(VulcanConfigSchema.parse({ guard: { writes: {} } }).guard.git).toEqual({
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

describe('claude.settings.env', () => {
  const parseEnv = (env: Record<string, unknown>) =>
    VulcanConfigSchema.safeParse({ claude: { settings: { env } } });

  test.each([
    'VULCAN_GUARD_ASKS',
    'VULCAN_GUARD_OUTSIDE',
    'VULCAN_GUARDS',
    'VULCAN_GUARD_ANYTHING',
  ])("refuses %s: it is the owner's choice and belongs in the launch environment", (name) => {
    const result = parseEnv({ [name]: 'ask' });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain(name);
  });

  test.each([
    'BUN_OPTIONS',
    'NODE_OPTIONS',
    'BUN_CONFIG_REGISTRY',
    'BUN_CONFIG_VERBOSE_FETCH',
    'BUN_INSPECT',
    'BUN_INSPECT_CONNECT_TO',
  ])('refuses %s: bun loads it before a guard runs, and every hook inherits this env', (name) => {
    const result = parseEnv({ [name]: '--preload=./x.ts' });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain(name);
  });

  test('takes the other BUN_ and NODE_ names, and settings with no env', () => {
    expect(parseEnv({ BUN_INSTALL: '/x', NODE_ENV: 'test', MY_BUN_OPTIONS: '1' }).success).toBe(
      true,
    );
  });

  test('takes the other variables, and settings with no env', () => {
    expect(parseEnv({ MY_FLAG: '1', VULCAN_ACTOR: 'a' }).success).toBe(true);
    expect(
      VulcanConfigSchema.safeParse({ claude: { settings: { permissions: { deny: [] } } } }).success,
    ).toBe(true);
    expect(VulcanConfigSchema.parse({}).claude.settings).toEqual({});
  });
});

describe('guard.asks', () => {
  test('defaults to ask, and takes ask or deny', () => {
    expect(VulcanConfigSchema.parse({}).guard.asks).toBe('ask');
    expect(VulcanConfigSchema.parse({ guard: {} }).guard.asks).toBe('ask');
    expect(parse({ asks: 'ask' }).success).toBe(true);
    expect(VulcanConfigSchema.parse({ guard: { asks: 'deny' } }).guard.asks).toBe('deny');
  });

  test('anything else is refused', () => {
    expect(parse({ asks: 'allow' }).success).toBe(false);
    expect(parse({ asks: true }).success).toBe(false);
    expect(parse({ asks: { mode: 'deny' } }).success).toBe(false);
  });
});

describe('guard.outside', () => {
  test('defaults to ask, and takes ask or deny', () => {
    expect(VulcanConfigSchema.parse({}).guard.outside).toBe('ask');
    expect(VulcanConfigSchema.parse({ guard: {} }).guard.outside).toBe('ask');
    expect(parse({ outside: 'ask' }).success).toBe(true);
    expect(VulcanConfigSchema.parse({ guard: { outside: 'deny' } }).guard.outside).toBe('deny');
  });

  test('anything else is refused', () => {
    expect(parse({ outside: 'allow' }).success).toBe(false);
    expect(parse({ outside: true }).success).toBe(false);
    expect(parse({ outside: { mode: 'deny' } }).success).toBe(false);
  });
});
