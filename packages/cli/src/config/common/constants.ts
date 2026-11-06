/** What a package of the project is: an app, or a library other apps import. */
export class PackageKinds {
  static readonly APP = 'app';
  static readonly LIB = 'lib';
}

/** Which preset kind made a library: `lib` (may use the project's framework) or `shared` (depends on no framework). */
export class LibraryKinds {
  static readonly LIB = 'lib';
  static readonly SHARED = 'shared';

  static readonly SCHEME_SET = new Set<string>([this.LIB, this.SHARED]);

  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

/** The agents `vulcan sync` writes adapters for. */
export class CodingAgents {
  static readonly CLAUDE = 'claude';

  /** The ids of `base/agents.json`, in its order; a test keeps the two in step. */
  static readonly SCHEME_SET = new Set<string>([
    this.CLAUDE,
    'omp',
    'codex',
    'cursor',
    'copilot-cli',
    'copilot-vscode',
    'antigravity',
    'pi',
  ]);

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
  /** The one config file name, under `.configs/`. */
  static readonly FILE = 'vulcan.config.mts';
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
    'V-C-09',
    'V-C-10',
    'V-P-08',
    'V-B-07',
    'V-B-09',
  ];
}

/** The placeholders a release template (`atlas.tagPattern`, `atlas.legacyTagPatterns`) knows; any other `<word>` would be read as literal text and match no tag. */
export class TemplatePlaceholders {
  static readonly ALLOWED = ['dir', 'version', 'issue', 'date'];
  private static readonly PATTERN = /<([^<>\s]*)>/g;

  /** The `<word>` placeholders of the template that are not allowed, each once, in the order they appear. */
  static unknownIn(opts: { template: string }): string[] {
    const found = [...opts.template.matchAll(TemplatePlaceholders.PATTERN)].map(
      (match) => match[1] ?? '',
    );

    return [...new Set(found)].filter((word) => !TemplatePlaceholders.ALLOWED.includes(word));
  }

  /** What the config error says: the placeholders it does not know, the ones it does, and what replaces `<package>`. */
  static problemOf(opts: { unknown: string[] }): string {
    const named = opts.unknown.map((word) => `<${word}>`).join(', ');
    const hint = opts.unknown.includes('package')
      ? ' <dir> replaces <package>: it is the package directory.'
      : '';
    const allowed = TemplatePlaceholders.ALLOWED.map((word) => `<${word}>`).join(', ');

    return `${named} is not a placeholder of a release template (${allowed}).${hint}`;
  }
}
