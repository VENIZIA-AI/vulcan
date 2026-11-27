import { EnvVariables } from '../common/env-variables.ts';
import { ConstClass } from '../common/types.ts';

/** The sections of a reply to the owner; a project picks which appear and in what order. */
export class OwnerSections extends ConstClass {
  static readonly HEADLINE = 'headline';
  static readonly MINIMAP = 'minimap';
  static readonly BLOCKED = 'blocked';
  static readonly DETAIL = 'detail';
  static readonly DECISIONS = 'decisions';
}

/** Whether the shape card is shown: `off` leaves it out, `advise` and `block` show it. The stricter of two values wins. */
export class OwnerEnforcement extends ConstClass {
  static readonly OFF = 'off';
  static readonly ADVISE = 'advise';
  static readonly BLOCK = 'block';
  /** From the loosest to the strictest: the stricter of two values wins. */
  static readonly STRICTNESS = [this.OFF, this.ADVISE, this.BLOCK] as const;
}

export class OwnerTones extends ConstClass {
  static readonly TERSE = 'terse';
  static readonly NEUTRAL = 'neutral';
  static readonly FRIENDLY = 'friendly';
}

export class OwnerFormalities extends ConstClass {
  static readonly INFORMAL = 'informal';
  static readonly NEUTRAL = 'neutral';
  static readonly FORMAL = 'formal';
}

export class OwnerDetails extends ConstClass {
  static readonly HEADLINE = 'headline';
  static readonly TABLES = 'tables';
}

const DEFAULT_MINIMAP_COLUMNS: [string, string, string] = ['#', 'Task', 'Status'];

export class OwnerConstants {
  /** The personal profile: one file per developer per project, gitignored, inside the project. */
  static readonly PROFILE_FILE = '.agents/local/profile.json';
  static readonly PROFILE_SCHEMA_VERSION = 1;
  static readonly DEFAULT_LANGUAGE = 'en';
  static readonly DEFAULT_SHAPE = [
    OwnerSections.HEADLINE,
    OwnerSections.MINIMAP,
    OwnerSections.BLOCKED,
    OwnerSections.DETAIL,
    OwnerSections.DECISIONS,
  ];

  /** The English label set, the only one that ships: any other language is the owner's own. */
  static readonly DEFAULT_LABELS = {
    minimapColumns: DEFAULT_MINIMAP_COLUMNS,
    status: {
      done: 'done',
      doing: 'in progress',
      waiting: 'waiting',
      todo: 'not started',
      blocked: 'blocked',
      dropped: 'dropped',
    },
    labels: {
      blocked: 'Blocked:',
      decisions: 'Decisions needed',
      noBlocker: 'none',
      noDecision: 'Nothing needed yet.',
      recommend: 'I recommend **{x}**.',
    },
  };

  static readonly DEFAULT_HEADLINE_MAX_SENTENCES = 2;
  /** A language code: a 2-3 letter primary tag and optional subtags (`en`, `pt-BR`); never a word like `constructor`. */
  static readonly LANGUAGE_PATTERN = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i;
  /** A label or a form of address sits inside one line of a digest card: no line breaks, backticks, pipes or quotes. */
  static readonly LABEL_PATTERN = /^[^\n\r`|"]{1,80}$/;
  /** The profile's free text, as the card shows it. */
  static readonly CARD_ABOUT_MAX_CHARACTERS = 200;
}

/** The launcher of a session whose replies an agent reads sets this; the owner's own sessions never have it. */
export class OwnerReplySwitch {
  static readonly ENV = EnvVariables.VULCAN_OWNER_REPLY;
  /** The only value that counts: anything else is ignored, so a stray value never switches the check off. */
  static readonly OFF = 'off';
}

/**
 * How the words of a reply are held: `exact` when a label set exists for the reader's language (the
 * owner's own words, or the shipped English), `free` when the reader's language is not English and has
 * none: the agent writes the labels in that language and the check looks at the structure only.
 */
export class OwnerLabelModes {
  static readonly EXACT = 'exact';
  static readonly FREE = 'free';
}
