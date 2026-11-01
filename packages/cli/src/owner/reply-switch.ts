import { OwnerReplySwitch } from './constants.ts';

export class ReplySwitch {
  /**
   * Whether the session was started with `VULCAN_OWNER_REPLY=off`: its reader is an agent, so the owner's
   * report shape is neither shown nor checked in it. Only the exact value `off` counts.
   */
  static isOwnerOff(opts: { env: Record<string, string | undefined> }): boolean {
    return opts.env[OwnerReplySwitch.ENV] === OwnerReplySwitch.OFF;
  }
}
