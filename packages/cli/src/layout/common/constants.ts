import { ConstClass } from '../../common/types.ts';

/** The rules of the layout check, by the id a finding and a baseline entry carry. */
export class LayoutRules extends ConstClass {
  /** A file name whose role part is plural, `user.helpers.ts`: the role names what one file is. */
  static readonly PLURAL_SUFFIX = 'plural-suffix';
  /** A folder with many subfolders and loose source files beside them. */
  static readonly MIXED_FOLDER = 'mixed-folder';
  /** A source file longer than `doctor.layout.maxLines`, not generated and not a test. */
  static readonly LONG_FILE = 'long-file';
}

export class LayoutConstants {
  /** The baseline a project adopts the check with, from the root. */
  static readonly BASELINE_FILE = '.configs/layout-baseline.json';
  static readonly DEFAULT_MAX_LINES = 600;
  /** The most bytes of `git ls-files -z` output read: a monorepo of 30,000 files lists about 2.5 MB. */
  static readonly MAX_LISTING_BYTES = 256 * 1024 * 1024;
  static readonly DEFAULT_MIN_SUBFOLDERS = 3;
  /** The folder name the source roots fall back to when the config names no package and no layout folder. */
  static readonly SOURCE_FOLDER = 'src';
  static readonly SOURCE_FILE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
  /** The loose files a folder of subfolders may keep: its entry point. */
  static readonly INDEX_FILES = ['index.ts', 'index.tsx'];
  /** A test file, which has no length limit: under a `__tests__` folder, or named `<stem>.test.<extension>`. */
  static readonly TEST_FILE = /(?:^|\/)__tests__\/|\.test\.[^./]+$/;
  /** A header comment that marks a file as written by a tool. */
  static readonly GENERATED_HEADER = /generated|do not edit/i;
  /** How many lines from the top are read as the header. */
  static readonly HEADER_LINES = 10;
  /** Plurals the "drop the s" rule gets wrong. */
  static readonly IRREGULAR_PLURALS: Readonly<Record<string, string>> = {
    aliases: 'alias',
    analyses: 'analysis',
    classes: 'class',
    indices: 'index',
    processes: 'process',
    statuses: 'status',
  };
  /** Role words that end in s and are not plurals; a project adds its own in `doctor.layout.pluralAllow`. */
  static readonly NOT_PLURAL = [
    'access',
    'alias',
    'analysis',
    'canvas',
    'class',
    'css',
    'process',
    'status',
    'stories',
  ];
}
