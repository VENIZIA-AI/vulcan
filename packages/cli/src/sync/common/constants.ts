import { join } from 'node:path';

export class SyncStatuses {
  static readonly CREATED = 'created';
  static readonly REPLACED = 'replaced';
  static readonly UNCHANGED = 'unchanged';
  static readonly SKIPPED = 'skipped';
  static readonly REMOVED = 'removed';
}

export class SyncConstants {
  static readonly CLAUDE_IMPORT_LINE = '@AGENTS.md';
  static readonly CLAUDE_TOOL_FILE = 'CLAUDE.md';

  static readonly CLAUDE_DIRECTORY = '.claude';
  static readonly SETTINGS_FILE = 'settings.json';
  /** The hook sync adds when the config sets `remoteHosts`; lives next to the shipped settings. */
  static readonly REMOTE_HOSTS_FILE = 'remote-hosts.json';
  static readonly COMMIT_ATTRIBUTION_FILE = 'commit-attribution.json';
  /** What sync applied last time, so a later sync can take back what the project no longer asks for. */
  static readonly MANAGED_FILE = 'vulcan-managed.json';
  static readonly SKILLS_DIRECTORY = 'skills';
  /** The Claude skills folder, relative to the project root. */
  static readonly CLAUDE_SKILLS = join(this.CLAUDE_DIRECTORY, this.SKILLS_DIRECTORY);
  static readonly SKILL_FILE = 'SKILL.md';
  /** The settings key of hook entries: sync takes a managed hook back by its command, not its whole entry. */
  static readonly HOOKS_KEY = 'hooks';
  /** Objects of independent entries: merged one level deep, so personal entries survive shared ones. */
  static readonly MERGE_ONE_LEVEL = new Set(['permissions', 'hooks', 'enabledPlugins', 'env']);
  /** Top-level lists that merge as a union, so the user's own entries survive the shared ones. */
  static readonly UNION_ARRAYS = new Set(['enabledMcpjsonServers']);
}

/** How a base rule moved between the manifest's last sync and the installed base. */
export class BaseRuleChanges {
  static readonly ADDED = 'added';
  static readonly CHANGED = 'changed';
  static readonly REMOVED = 'removed';
}
