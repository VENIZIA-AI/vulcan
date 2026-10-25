import { afterAll, beforeAll } from 'bun:test';
import { OwnerReplySwitch } from '../owner/index.ts';

/** A test of the owner shape runs as if no launcher had set the switch, even inside a session that has it. */
export const isolateOwnerReplySwitch = (): void => {
  const inherited = process.env[OwnerReplySwitch.ENV];

  beforeAll(() => {
    delete process.env[OwnerReplySwitch.ENV];
  });

  afterAll(() => {
    if (inherited !== undefined) {
      process.env[OwnerReplySwitch.ENV] = inherited;
    }
  });
};
