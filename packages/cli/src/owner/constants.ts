/** The sections of a reply to the owner; a project picks which appear and in what order. */
export class OwnerSections {
  static readonly HEADLINE = 'headline';
  static readonly MINIMAP = 'minimap';
  static readonly BLOCKED = 'blocked';
  static readonly DETAIL = 'detail';
  static readonly DECISIONS = 'decisions';
  static readonly SCHEME_SET = new Set<string>([
    this.HEADLINE,
    this.MINIMAP,
    this.BLOCKED,
    this.DETAIL,
    this.DECISIONS,
  ]);
  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

/** How hard the shape of an owner reply is held: not at all, by a reminder, or by blocking a wrong one once. */
export class OwnerEnforcement {
  static readonly OFF = 'off';
  static readonly ADVISE = 'advise';
  static readonly BLOCK = 'block';
  /** From the loosest to the strictest: the stricter of two values wins. */
  static readonly STRICTNESS = [this.OFF, this.ADVISE, this.BLOCK] as const;
  static readonly SCHEME_SET = new Set<string>(this.STRICTNESS);
  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

export class OwnerTones {
  static readonly TERSE = 'terse';
  static readonly NEUTRAL = 'neutral';
  static readonly FRIENDLY = 'friendly';
  static readonly SCHEME_SET = new Set<string>([this.TERSE, this.NEUTRAL, this.FRIENDLY]);
  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

export class OwnerFormalities {
  static readonly INFORMAL = 'informal';
  static readonly NEUTRAL = 'neutral';
  static readonly FORMAL = 'formal';
  static readonly SCHEME_SET = new Set<string>([this.INFORMAL, this.NEUTRAL, this.FORMAL]);
  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

export class OwnerDetails {
  static readonly HEADLINE = 'headline';
  static readonly TABLES = 'tables';
  static readonly SCHEME_SET = new Set<string>([this.HEADLINE, this.TABLES]);
  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
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
  /** A reply shorter than this many words (an acknowledgement) is exempt from the shape; 0 checks every reply. */
  static readonly DEFAULT_SHORT_REPLY_WORDS = 20;
  static readonly MAX_SHORT_REPLY_WORDS = 200;
  /** A language code: a 2-3 letter primary tag and optional subtags (`en`, `pt-BR`); never a word like `constructor`. */
  static readonly LANGUAGE_PATTERN = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i;
  /** A label or a form of address sits inside one line of a digest card: no line breaks, backticks, pipes or quotes. */
  static readonly LABEL_PATTERN = /^[^\n\r`|"]{1,80}$/;
  /** The profile's free text, as the card shows it. */
  static readonly CARD_ABOUT_MAX_CHARACTERS = 200;
}
