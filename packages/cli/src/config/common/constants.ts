import { ConstClass } from '../../common/types.ts';

/** What a package of the project is: an app, or a library other apps import. */
export class PackageKinds {
  static readonly APP = 'app';
  static readonly LIB = 'lib';
}

/** Which preset kind made a library: `lib` (may use the project's framework) or `shared` (depends on no framework). */
export class LibraryKinds extends ConstClass {
  static readonly LIB = 'lib';
  static readonly SHARED = 'shared';
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

export class ConfigConstants {
  static readonly DIRECTORY = '.configs';
  /** The one config file name, under `.configs/`. */
  static readonly FILE = 'vulcan.config.mts';
  /** The modules `vulcan init` splits the config into, under `.configs/`: the index the config imports and one per large section. */
  static readonly SPLIT_MODULES = [
    'vulcan/index.mts',
    'vulcan/claude.mts',
    'vulcan/doctor.mts',
    'vulcan/okf.mts',
    'vulcan/packages.mts',
  ];
  static readonly DEFAULT_KNOWLEDGE_BUNDLE = '.agents/knowledge';
  static readonly RULE_ID_PATTERN = /^(?:[A-Z]+-)?[A-Z]-\d{2}$/;
  /**
   * The arrays a shipped layer may add to and a project may `remove` from, each with the field that names an item of an array
   * of objects, or the fields that together name it (an acknowledgement is its `path` and its `kinds`, written `path|kind,kind`); `undefined`: the items are strings, named by themselves. One list for the merge and for the schema.
   */
  static readonly LAYERED_ARRAYS: Readonly<Record<string, string | string[] | undefined>> = {
    'claude.settings.permissions.allow': undefined,
    'claude.settings.permissions.deny': undefined,
    presets: 'spec',
    'atlas.sources': 'name',
    'digest.oftenDropped': undefined,
    'doctor.privateValues.acknowledged': ['path', 'kinds'],
  };
}

/** The placeholders a release template (`atlas.tagPattern`, `atlas.legacyTagPatterns`) knows; any other `<word>` would be read as literal text and match no tag. */
export class TemplatePlaceholders {
  static readonly ALLOWED = ['dir', 'version', 'issue', 'date'];
  private static readonly PATTERN = /<([^<>]*)>/g;

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

    const verb = opts.unknown.length === 1 ? 'is not a placeholder' : 'are not placeholders';

    return `${named} ${verb} of a release template (${allowed}).${hint}`;
  }
}

/** The order `vulcan config format` gives the top-level keys of the config file; a key not listed goes after them, and `remove` always last. */
export class ConfigKeyOrder {
  static readonly KEYS: readonly string[] = [
    'name',
    'project',
    'agents',
    'packs',
    'rules',
    'digest',
    'owner',
    'layout',
    'packages',
    'presets',
    'guard',
    'commit',
    'events',
    'board',
    'knowledge',
    'okf',
    'atlas',
    'claude',
    'doctor',
    'local',
    'theme',
  ];
  static readonly LAST = 'remove';

  /** Where a key goes: its index in `KEYS`, after them when it is not listed, and `remove` last. */
  static rankOf(opts: { key: string }): number {
    if (opts.key === ConfigKeyOrder.LAST) {
      return ConfigKeyOrder.KEYS.length + 1;
    }

    const index = ConfigKeyOrder.KEYS.indexOf(opts.key);

    return index === -1 ? ConfigKeyOrder.KEYS.length : index;
  }

  /** Whether `keys` are in the order already. */
  static isOrdered(opts: { keys: string[] }): boolean {
    return opts.keys.every(
      (key, index) =>
        index === 0 ||
        ConfigKeyOrder.rankOf({ key: opts.keys[index - 1] }) <= ConfigKeyOrder.rankOf({ key }),
    );
  }
}
