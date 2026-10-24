import { loadConfig } from '../config/index.ts';
import {
  checkOwnerShape,
  OWNER_SCHEMA,
  OwnerEnforcement,
  readLastClasses,
  readProfile,
  markBlocked,
  recordReply,
  wasBlockedRecently,
  resolveOwnerView,
  ShapeClasses,
} from '../owner/index.ts';
import type { IOwnerView } from '../owner/index.ts';

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
export const loadOwnerView = async (opts: { projectRoot: string }): Promise<IOwnerView> => {
  const loaded = await loadConfig({ root: opts.projectRoot });
  const profile = readProfile({ root: opts.projectRoot });

  return resolveOwnerView({
    owner: loaded.ok ? loaded.config.owner : OWNER_SCHEMA.parse(undefined),
    profile: profile.ok ? profile.profile : undefined,
  });
};

/**
 * The Stop hook's answer for the last reply: it is checked and recorded (classes and date only), and
 * only under `block`, once per message and only for a structural fault, is it sent back to be restated.
 * Anything it cannot read passes: it never stops a session by failing.
 */
export const buildStopOutput = async (opts: {
  projectRoot: string;
  input: unknown;
}): Promise<Record<string, unknown> | undefined> => {
  const { input } = opts;

  if (typeof input !== 'object' || input === null || !('last_assistant_message' in input)) {
    return undefined;
  }

  const { last_assistant_message: text } = input;
  const isRetry = 'stop_hook_active' in input && input.stop_hook_active === true;
  const view = await loadOwnerView({ projectRoot: opts.projectRoot });

  if (typeof text !== 'string' || view.enforce === OwnerEnforcement.OFF) {
    return undefined;
  }

  const result = checkOwnerShape({ text, view });

  // Every reply updates the note the next prompt reads, an exempt short one too; a write that fails never
  // costs the decision below.
  try {
    recordReply({ root: opts.projectRoot, classes: result.classes });
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
    wasBlockedRecently({ root: opts.projectRoot })
  ) {
    return undefined;
  }

  try {
    markBlocked({ root: opts.projectRoot });
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
};

/**
 * One line added to every prompt while the shape is held: the contract, and the faults of the reply
 * before when it had any. Empty when the shape is not enforced.
 */
export const buildPromptContract = async (opts: { projectRoot: string }): Promise<string> => {
  const view = await loadOwnerView({ projectRoot: opts.projectRoot });

  if (view.enforce === OwnerEnforcement.OFF) {
    return '';
  }

  const last = readLastClasses({ root: opts.projectRoot });

  return last.length === 0
    ? 'Owner reply contract: follow the report shape from the session rules.'
    : `Owner reply contract: follow the report shape from the session rules. Your last reply broke it - ${last.map((name) => FIXES[name] ?? name).join('; ')}.`;
};
