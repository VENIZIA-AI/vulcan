import { expect, test } from 'bun:test';
import { SmokeEnv } from '../smoke-env.ts';

test('the owner variables of VULCAN and Claude Code are dropped, the rest of the environment is kept', () => {
  const env = SmokeEnv.of({
    env: {
      PATH: '/usr/bin',
      HOME: '/home/a',
      TMPDIR: '/work/tmp',
      VULCAN_OWNER_REPLY: 'off',
      VULCAN_GUARDS: 'off',
      VULCAN_ACTOR: 'me',
      CLAUDECODE: '1',
      CLAUDE_PROJECT_DIR: '/work',
      CLAUDE_CODE_TMPDIR: '/work/tmp',
      UNSET: undefined,
    },
  });

  expect(env).toEqual({ PATH: '/usr/bin', HOME: '/home/a', TMPDIR: '/work/tmp' });
});

test('a step sets the names it needs in extra, and extra wins over the caller', () => {
  const env = SmokeEnv.of({
    env: { PATH: '/usr/bin', VULCAN_NPM_REGISTRY: 'https://real.example', NODE_ENV: 'development' },
    extra: { CLAUDE_PROJECT_DIR: '/sandbox', NODE_ENV: 'production' },
  });

  expect(env).toEqual({ PATH: '/usr/bin', CLAUDE_PROJECT_DIR: '/sandbox', NODE_ENV: 'production' });
});
