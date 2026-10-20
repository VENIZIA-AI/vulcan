/** What `vulcan x` hands every tool; okf reads nothing else for its project. */
export class OkfProjectConstants {
  static readonly CONFIG_ENV = 'VULCAN_CONFIG';
  static readonly ROOT_ENV = 'VULCAN_PROJECT_ROOT';
  static readonly DEFAULT_BUNDLE = '.agents/knowledge';
  static readonly DEFAULT_VIZ_OUTPUT = '.agents/knowledge/viz.html';
  static readonly DEFAULT_TAG_PATTERN = '<dir>-v<version>';
  /** Agent-read files outside the bundle that get a contents list when they grow long. */
  static readonly DEFAULT_CONTENTS_FILES = ['AGENTS.md', '.agents/rules.md'];
}
