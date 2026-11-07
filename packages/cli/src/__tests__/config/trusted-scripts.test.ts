import { describe, expect, test } from 'bun:test';
import { VULCAN_CONFIG_SCHEMA } from '../../config/index.ts';

describe('guard.writes.trustedScripts', () => {
  test('is refused, with the key and what to do', () => {
    const result = VULCAN_CONFIG_SCHEMA.safeParse({
      guard: { writes: { trustedScripts: ['auroras/tools/i18n/cli.ts'] } },
    });
    const issues = result.success ? [] : result.error.issues;

    expect(result.success).toBe(false);
    expect(issues.map((issue) => issue.path.join('.'))).toEqual(['guard.writes.trustedScripts']);
    expect(issues[0]?.message).toContain('removed: delete this key');
  });

  test('leaves guard.writes.commands and the defaults as they were', () => {
    const config = VULCAN_CONFIG_SCHEMA.parse({ guard: { writes: {} } });

    expect(config.guard.writes).toEqual({ commands: [] });
  });
});
