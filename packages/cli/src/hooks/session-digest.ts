import { ConfigLoader } from '../config/index.ts';
import { OWNER_SCHEMA, OwnerCard, OwnerProfile, OwnerView, ReplySwitch } from '../owner/index.ts';
import { ClaudeLaunch } from '../sync/claude-launch.ts';

/**
 * Builds the digest printed at session start by the session-start hook: what only this session knows - a config
 * problem, a launch warning, how to answer this owner. The rules themselves are the block of AGENTS.md
 * (`RulesBlock`), which every agent reads, Claude Code through CLAUDE.md.
 */
export class SessionDigest {
  /** Claude Code gives the model a hook's output whole up to 10,000 bytes, beyond that a file and its first 2 KB; the digest stays within the 2 KB. */
  static readonly MAX_BYTES = 2048;

  static async build(opts: {
    projectRoot: string;
    /** The environment of the session; `VULCAN_OWNER_REPLY=off` leaves out the owner's shape and profile cards. */
    env?: Record<string, string | undefined>;
  }): Promise<string> {
    const loaded = await ConfigLoader.load({ root: opts.projectRoot });
    const configNote = ConfigLoader.unreadableNote({ loaded });
    const launchWarning = ClaudeLaunch.missWarning({
      root: opts.projectRoot,
      env: opts.env ?? process.env,
    });
    const lines = [
      '# VULCAN session',
      '',
      'The rules are in AGENTS.md ("Rules that must not be skipped"); the full text is `node_modules/@venizia/vulcan/base/rules.md` and `.agents/rules.md`.',
      ...(configNote === undefined
        ? []
        : ['', '## Config problem', '', `This session: ${configNote}.`]),
      ...(launchWarning === undefined ? [] : ['', '## Launch warning', '', launchWarning]),
    ];

    // A session whose reader is an agent: the owner's shape and the person's profile are not its business.
    if (!ReplySwitch.isOwnerOff({ env: opts.env ?? process.env })) {
      const profile = OwnerProfile.read({ root: opts.projectRoot });
      const view = OwnerView.resolve({
        owner: loaded.ok ? loaded.config.owner : OWNER_SCHEMA.parse(undefined),
        profile: profile.ok ? profile.profile : undefined,
      });
      const shape = OwnerCard.renderShape({ view });
      const profileCard = OwnerCard.renderProfile({ view });

      if (shape.length > 0) {
        lines.push('', ...shape);
      }

      if (profileCard.length > 0) {
        lines.push('', ...profileCard);
      }
    }

    return `${lines.join('\n')}\n`;
  }
}
