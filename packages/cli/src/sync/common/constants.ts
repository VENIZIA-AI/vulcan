export class SyncStatuses {
  static readonly CREATED = 'created';
  static readonly REPLACED = 'replaced';
  static readonly UNCHANGED = 'unchanged';
  static readonly SKIPPED = 'skipped';
  static readonly SCHEME_SET = new Set<string>([
    this.CREATED,
    this.REPLACED,
    this.UNCHANGED,
    this.SKIPPED,
  ]);
  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

export class SyncConstants {
  static readonly CLAUDE_IMPORT_LINE = '@AGENTS.md';
  static readonly CLAUDE_TOOL_FILE = 'CLAUDE.md';
  static readonly CLAUDE_DIRECTORY = '.claude';
  static readonly SETTINGS_FILE = 'settings.json';
  /** What sync applied last time, so a later sync can take back what the project no longer asks for. */
  static readonly MANAGED_FILE = 'vulcan-managed.json';
  static readonly SKILLS_DIRECTORY = 'skills';
  static readonly SKILL_FILE = 'SKILL.md';
  /** Objects of independent entries: merged one level deep, so personal entries survive shared ones. */
  static readonly MERGE_ONE_LEVEL = new Set(['permissions', 'hooks', 'enabledPlugins', 'env']);
}

/** How a base rule moved between the manifest's last sync and the installed base. */
export class BaseRuleChanges {
  static readonly ADDED = 'added';
  static readonly CHANGED = 'changed';
  static readonly REMOVED = 'removed';
  static readonly SCHEME_SET = new Set<string>([this.ADDED, this.CHANGED, this.REMOVED]);
  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}
