import { ConfigLoader } from '../config/index.ts';
import {
  OwnerShape,
  OWNER_SCHEMA,
  OwnerEnforcement,
  ReplySwitch,
  ViolationLog,
  OwnerProfile,
  OwnerView,
  ShapeClasses,
} from '../owner/index.ts';
import type { IOwnerView } from '../owner/index.ts';
import { ReplyClaims, SignalState } from '../signals/index.ts';

/** What to do about each class, in the words of the block message. */
const FIXES: Record<string, string> = {
  [ShapeClasses.HEADLINE_NOT_SENTENCE]:
    'open with a plain sentence that answers first, not a heading, list or table',
  [ShapeClasses.HEADLINE_TOO_LONG]: 'cut the headline to the sentence cap',
  [ShapeClasses.MINIMAP_MISSING]: 'add the minimap table with the configured header',
  [ShapeClasses.MINIMAP_STATUS]: 'use only the configured status words in the minimap',
  [ShapeClasses.BLOCKED_MISSING]: 'add the Blocked line, or its none string',
  [ShapeClasses.DECISIONS_MISSING]: 'add the decisions section, or exactly its none string',
  [ShapeClasses.DECISIONS_MALFORMED]: 'number the decisions',
  [ShapeClasses.DECISIONS_NO_RECOMMENDATION]: 'end each decision with the recommendation pattern',
  [ShapeClasses.SECTION_ORDER]: 'put the sections in the configured order',
  [ShapeClasses.EMOJI]: 'remove emoji',
  [ShapeClasses.SHOUTING]: 'no all-caps phrases',
  [ShapeClasses.RELATIVE_PATH]: 'name a file by its full absolute path',
};

/** The owner's view of the project in `projectRoot`; a project whose config cannot load gets the defaults. */
const loadOwnerView = async (opts: { projectRoot: string }): Promise<IOwnerView> => {
  const loaded = await ConfigLoader.load({ root: opts.projectRoot });
  const profile = OwnerProfile.read({ root: opts.projectRoot });
  const note = ConfigLoader.unreadableNote({ loaded });

  if (note !== undefined) {
    console.error(`vulcan: the owner-reply hook: ${note}`);
  }

  return OwnerView.resolve({
    owner: loaded.ok ? loaded.config.owner : OWNER_SCHEMA.parse(undefined),
    profile: profile.ok ? profile.profile : undefined,
  });
};

export class OwnerReply {
  /**
   * The Stop hook's answer for the last reply: it is checked and recorded (classes and date only), and
   * only under `block`, once per message and only for a structural fault, is it sent back to be restated.
   * Anything it cannot read passes: it never stops a session by failing. A session started with
   * `VULCAN_OWNER_REPLY=off` (a session whose reader is an agent) is not checked, logged or blocked at all.
   */
  static async buildStopOutput(opts: {
    projectRoot: string;
    input: unknown;
    /** The environment of the session; `VULCAN_OWNER_REPLY=off` exempts it. */
    env?: Record<string, string | undefined>;
  }): Promise<Record<string, unknown> | undefined> {
    const { input } = opts;

    if (ReplySwitch.isOwnerOff({ env: opts.env ?? process.env })) {
      return undefined;
    }

    if (typeof input !== 'object' || input === null || !('last_assistant_message' in input)) {
      return undefined;
    }

    const { last_assistant_message: text } = input;
    const isRetry = 'stop_hook_active' in input && input.stop_hook_active === true;
    const session =
      'session_id' in input && typeof input.session_id === 'string' ? input.session_id : '';
    const view = await loadOwnerView({ projectRoot: opts.projectRoot });

    if (typeof text !== 'string' || view.enforce === OwnerEnforcement.OFF) {
      return undefined;
    }

    const result = OwnerShape.check({ text, view });
    // A claim is checked on every reply, a short one too: "Published." is the shortest wrong one.
    const claims = ReplyClaims.check({
      text,
      state: SignalState.read({ root: opts.projectRoot, session }),
      publicWords: view.claimWords.public,
      doneWords: view.claimWords.done,
    });
    const classes = [...result.classes, ...claims];

    // Every reply updates the note the next prompt reads, an exempt short one too; a write that fails never
    // costs the decision below.
    try {
      ViolationLog.recordReply({ root: opts.projectRoot, classes, session });
    } catch {
      // The log is advisory.
    }

    if (!result.isChecked) {
      return undefined;
    }

    const structural = result.classes.filter((name) => ShapeClasses.isStructural(name));

    if (
      view.enforce !== OwnerEnforcement.BLOCK ||
      isRetry ||
      structural.length === 0 ||
      ViolationLog.wasBlockedRecently({ root: opts.projectRoot, session })
    ) {
      return undefined;
    }

    try {
      ViolationLog.markBlocked({ root: opts.projectRoot, session });
    } catch {
      // Without the note the stop_hook_active flag is the only guard against a second block.
    }

    return {
      decision: 'block',
      reason: [
        'The reply to the owner breaks the report shape (see "How to answer the owner" in the session rules). Restate it once, in full:',
        ...structural.map((name) => `  - ${name}: ${FIXES[name] ?? name}`),
      ].join('\n'),
    };
  }

  /**
   * One line added to every prompt while the shape is held: the contract, and the faults of the reply
   * before when it had any. Empty when the shape is not enforced.
   */
  static async buildPromptContract(opts: {
    projectRoot: string;
    /** The session the prompt belongs to; its turn begins here. */
    session?: string;
    /** The environment of the session; `VULCAN_OWNER_REPLY=off` exempts it. */
    env?: Record<string, string | undefined>;
  }): Promise<string> {
    // A new turn begins with this prompt: the notes of the last one are forgotten, whatever is enforced.
    try {
      SignalState.startTurn({ root: opts.projectRoot, session: opts.session ?? '' });
    } catch {
      // The notes are advisory.
    }

    if (ReplySwitch.isOwnerOff({ env: opts.env ?? process.env })) {
      return '';
    }

    const view = await loadOwnerView({ projectRoot: opts.projectRoot });

    if (view.enforce === OwnerEnforcement.OFF) {
      return '';
    }

    // A claim match is a hint, so it is logged but never said back to the model as a fault of the last reply.
    const last = ViolationLog.readLastClasses({
      root: opts.projectRoot,
      session: opts.session,
    }).filter((name) => ShapeClasses.isValid(name));

    return last.length === 0
      ? 'Owner reply contract: follow the report shape from the session rules.'
      : `Owner reply contract: follow the report shape from the session rules. Your last reply broke it - ${last.map((name) => FIXES[name] ?? name).join('; ')}.`;
  }
}
