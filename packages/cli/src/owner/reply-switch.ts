import { OwnerReplySwitch } from './constants.ts';

/**
 * Whether the session was started with `VULCAN_OWNER_REPLY=off`: its reader is an agent, so the owner's
 * report shape is neither shown nor checked in it. Only the exact value `off` counts.
 */
export const isOwnerReplyOff = (opts: { env: Record<string, string | undefined> }): boolean =>
  opts.env[OwnerReplySwitch.ENV] === OwnerReplySwitch.OFF;
