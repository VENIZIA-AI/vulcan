/** Config file extensions, in lookup order. */
export class ConfigExtensions {
  static readonly TS = 'ts';
  static readonly MTS = 'mts';
  static readonly MJS = 'mjs';
  static readonly JS = 'js';

  static readonly LOOKUP_ORDER = [this.TS, this.MTS, this.MJS, this.JS] as const;

  static readonly SCHEME_SET = new Set<string>(this.LOOKUP_ORDER);

  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

/** The agents `vulcan sync` writes adapters for. */
export class CodingAgents {
  static readonly CLAUDE = 'claude';

  static readonly SCHEME_SET = new Set<string>([this.CLAUDE]);

  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

/** Claude Code hook events a project may add a hook to. */
export class HookEvents {
  static readonly PRE_TOOL_USE = 'PreToolUse';
  static readonly POST_TOOL_USE = 'PostToolUse';
  static readonly USER_PROMPT_SUBMIT = 'UserPromptSubmit';
  static readonly SESSION_START = 'SessionStart';
  static readonly STOP = 'Stop';

  static readonly SCHEME_SET = new Set<string>([
    this.PRE_TOOL_USE,
    this.POST_TOOL_USE,
    this.USER_PROMPT_SUBMIT,
    this.SESSION_START,
    this.STOP,
  ]);

  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

export class ConfigConstants {
  static readonly DIRECTORY = '.configs';
  static readonly BASENAME = 'vulcan.config';
  static readonly DEFAULT_KNOWLEDGE_BUNDLE = '.agents/knowledge';
  static readonly RULE_ID_PATTERN = /^(?:[A-Z]+-)?[A-Z]-\d{2}$/;
  /** The rules a session drops most, printed at every session start unless the project lists its own. */
  static readonly DEFAULT_OFTEN_DROPPED = [
    'V-P-07',
    'V-B-03',
    'V-P-05',
    'V-P-06',
    'V-B-04',
    'V-W-04',
    'V-C-02',
    'V-C-10',
  ];
}
