import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { z } from 'zod';
import type { TConstValue } from '@/common/types';
import { DirectoryPath } from '@/common/paths';
import { RecordValue } from '@/common/record';
import { TextValue } from '@/common/text';
import { MIGRATION_NAME_PATTERN, MigrationItemSchema } from '@/migrations/schema';
import type { TMigrationItem } from '@/migrations/schema';
import { Resolve } from './resolve';

/** The names of the sections of a version's `log.md`. */
export class VersionSectionNames {
  static readonly BREAKING = 'Breaking';
  static readonly DEPRECATED = 'Deprecated';
  static readonly ADDED = 'Added';
  static readonly CHANGED = 'Changed';
  static readonly FIXED = 'Fixed';
  static readonly SECURITY = 'Security';
}

export type TVersionSection = TConstValue<typeof VersionSectionNames>;

/** The sections of a version's `log.md`, in the order they must appear. */
export class VersionSections {
  static readonly ORDER: TVersionSection[] = [
    VersionSectionNames.BREAKING,
    VersionSectionNames.DEPRECATED,
    VersionSectionNames.ADDED,
    VersionSectionNames.CHANGED,
    VersionSectionNames.FIXED,
    VersionSectionNames.SECURITY,
  ];
  /** The sections whose items owe a block in `migration.yaml`. */
  static readonly OWING: TVersionSection[] = [
    VersionSectionNames.BREAKING,
    VersionSectionNames.DEPRECATED,
  ];

  /** The section named `name`, or `undefined` when it is not one. */
  static of(opts: { name: string }): TVersionSection | undefined {
    return VersionSections.ORDER.find((section) => section === opts.name);
  }
}

/** A block of `migration.yaml`: an item of the migration schema without its id, which is the key. */
export const MigrationBlockSchema = MigrationItemSchema.omit({ id: true });

export type TMigrationBlock = z.infer<typeof MigrationBlockSchema>;

/** One item of a `log.md`: `- **Title** \`id\` (\`@pkg\`): prose`. */
export interface IVersionItem {
  id: string;
  title: string;
  section: TVersionSection;
  /** The packages named after the id; empty when the item belongs to the file's packages. */
  packages: string[];
  /** The line of the item in the file, frontmatter included. */
  line: number;
  /** The item's text without its bullet: the line, and the lines under it (a code block included) up to the next item or heading. */
  body: string;
}

/** A reason a version folder is not valid; `file` is relative to the changelog folder. */
export interface IVersionProblem {
  file: string;
  message: string;
}

export interface IVersionFolder {
  /** The folder name: the stable the line will release. */
  name: string;
  version?: string;
  packages: string[];
  /** `YYYY-MM-DD`, set when the stable was released; absent while the line is in progress. */
  released?: string;
  /** The folder holds a readable `log.md` of its own: a directory, an unreadable file or a link out of the checkout is not one. */
  hasLog: boolean;
  /** `released:` is there but is not a date: the folder is neither released nor in progress. */
  hasInvalidRelease: boolean;
  /** Sections in the order they appear. */
  sections: TVersionSection[];
  items: IVersionItem[];
  /** The text between the frontmatter and the first heading: what the release is. */
  intro: string;
  /** The blocks of `migration.yaml` by item id; empty when the file is absent or `{}`. */
  blocks: Record<string, TMigrationBlock>;
  /** Everything wrong with the folder that parsing can see; the gate adds the rules that need the project. */
  problems: IVersionProblem[];
}

type TFail = (opts: { file: string; message: string }) => void;

/** A stable version: the name of a version folder and the form of a version cutover. */
export const STABLE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
/** Up to three spaces of indent, a run of three or more backticks or tildes, then the rest of the line. */
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const ITEM_LINE = /^- \*\*(.+?)\*\* `([^`]+)`(?: \(([^)]*)\))?/;
const BULLET_LINE = /^[-*] /;
const SECTION_LINE = /^## (.+?)\s*$/;
const RELEASED_DATE = /^\d{4}-\d{2}-\d{2}$/;
const YAML_TOP_KEY = /^(?!\s|#|-)(?:"([^"]+)"|'([^']+)'|([^:\n]+?))\s*:/gm;

const stringsOf = (opts: { value: unknown }): string[] =>
  Array.isArray(opts.value)
    ? opts.value.filter((item): item is string => typeof item === 'string')
    : [];

/** Reads `changelogs/<X.Y.Z>/{log.md, migration.yaml}`: what the version folder says, and what is wrong with its shape. */
export class VersionFolders {
  static isName(opts: { name: string }): boolean {
    return STABLE_VERSION_PATTERN.test(opts.name);
  }

  /**
   * The version folders of `directory`, oldest first; a directory that is not there has none. `within`: a fetched
   * checkout - a folder or file whose real path leaves it is not read.
   */
  static read(opts: { directory: string; within?: string }): IVersionFolder[] {
    if (!existsSync(opts.directory)) {
      return [];
    }

    return readdirSync(opts.directory)
      .filter(
        (name) =>
          STABLE_VERSION_PATTERN.test(name) &&
          VersionFolders.isDirectory({ path: join(opts.directory, name), within: opts.within }),
      )
      .sort((left, right) => Bun.semver.order(left, right))
      .map((name) =>
        VersionFolders.readOne({ directory: opts.directory, name, within: opts.within }),
      );
  }

  static readOne(opts: { directory: string; name: string; within?: string }): IVersionFolder {
    const folder = join(opts.directory, opts.name);

    return VersionFolders.parse({
      name: opts.name,
      log: VersionFolders.textOf({ file: join(folder, 'log.md'), within: opts.within }),
      migration: VersionFolders.textOf({
        file: join(folder, 'migration.yaml'),
        within: opts.within,
      }),
    });
  }

  /** A path that cannot be statted (a dangling link) is not a directory. */
  private static isDirectory(opts: { path: string; within?: string }): boolean {
    try {
      return (
        statSync(opts.path).isDirectory() &&
        (opts.within === undefined ||
          DirectoryPath.isWithin({ path: opts.path, directory: opts.within }))
      );
    } catch {
      return false;
    }
  }

  /** The text of a file that is a regular file inside `within`; `undefined` for anything else, so the folder reports it. */
  private static textOf(opts: { file: string; within?: string }): string | undefined {
    try {
      if (
        !statSync(opts.file).isFile() ||
        (opts.within !== undefined &&
          !DirectoryPath.isWithin({ path: opts.file, directory: opts.within }))
      ) {
        return undefined;
      }

      return readFileSync(opts.file, 'utf8');
    } catch {
      return undefined;
    }
  }

  /** A folder from the text of its two files, wherever they came from (disk, a git blob, the corpus). */
  static parse(opts: { name: string; log?: string; migration?: string }): IVersionFolder {
    const folder: IVersionFolder = {
      name: opts.name,
      packages: [],
      sections: [],
      items: [],
      intro: '',
      blocks: {},
      problems: [],
      hasLog: opts.log !== undefined,
      hasInvalidRelease: false,
    };
    // Ids of items the log already reported and dropped: the migration file does not report them again.
    const rejected = new Set<string>();
    const fail: TFail = ({ file, message }) => {
      folder.problems.push({ file: `${opts.name}/${file}`, message });
    };

    if (opts.log === undefined) {
      fail({ file: 'log.md', message: 'a version folder needs a log.md' });
    } else {
      VersionFolders.readLog({ folder, text: opts.log, fail, rejected });
    }

    if (opts.migration !== undefined) {
      VersionFolders.readMigration({ folder, text: opts.migration, fail, rejected });
    }

    return folder;
  }

  private static readLog(opts: {
    folder: IVersionFolder;
    text: string;
    fail: TFail;
    rejected: Set<string>;
  }): void {
    const { folder, fail, rejected } = opts;
    let data: Record<string, unknown>;
    let body: string;

    try {
      ({ data, body } = Resolve.splitFrontmatter(opts.text));
    } catch (error) {
      fail({ file: 'log.md', message: `invalid frontmatter: ${TextValue.messageOf({ error })}` });

      return;
    }

    const version = typeof data.version === 'string' ? data.version : undefined;

    if (version === folder.name) {
      folder.version = version;
    } else {
      fail({
        file: 'log.md',
        message: `version: must be '${folder.name}', the name of the folder`,
      });
    }

    folder.packages = stringsOf({ value: data.packages });

    if (data.released !== undefined) {
      const released = typeof data.released === 'string' ? data.released : '';

      if (RELEASED_DATE.test(released)) {
        folder.released = released;
      } else {
        folder.hasInvalidRelease = true;
        fail({ file: 'log.md', message: 'released: must be a date, YYYY-MM-DD' });
      }
    }

    // The lines of the body start after the frontmatter: a message names the line of the file.
    const offset = opts.text.split('\n').length - body.split('\n').length;
    let section: TVersionSection | undefined;
    let previous = -1;
    const seen = new Set<string>();
    let fence = '';
    let isBeforeSections = true;
    const introLines: string[] = [];
    let current: IVersionItem | undefined;
    let currentLines: string[] = [];
    const closeItem = (): void => {
      if (current !== undefined) {
        current.body = currentLines.join('\n').trim();
      }

      current = undefined;
      currentLines = [];
    };
    const keep = (text: string): void => {
      if (current !== undefined) {
        currentLines.push(text);
      } else if (isBeforeSections) {
        introLines.push(text);
      }
    };

    body.split('\n').forEach((text, index) => {
      const line = index + 1 + offset;

      // A code block shows an example: its bullets and `## ` lines are not items and sections. A fence closes only on
      // a run of the same character, at least as long, with nothing after it.
      const marker = FENCE_LINE.exec(text);

      if (fence !== '') {
        if (
          marker !== null &&
          marker[1][0] === fence[0] &&
          marker[1].length >= fence.length &&
          marker[2].trim() === ''
        ) {
          fence = '';
        }

        keep(text);

        return;
      }

      if (marker !== null && !(marker[1][0] === '`' && marker[2].includes('`'))) {
        fence = marker[1];
        keep(text);

        return;
      }

      const heading = SECTION_LINE.exec(text);

      if (heading !== null) {
        closeItem();
        isBeforeSections = false;

        const known = VersionSections.of({ name: heading[1] });

        VersionFolders.openSection({ folder, name: heading[1], previous, fail });
        section = known;
        previous = known === undefined ? previous : VersionSections.ORDER.indexOf(known);

        return;
      }

      if (!BULLET_LINE.test(text)) {
        keep(text);

        return;
      }

      closeItem();

      const item = ITEM_LINE.exec(text);

      if (item === null) {
        fail({
          file: 'log.md',
          message: `line ${line}: an item reads "- **Title** \`item-id\`: prose"`,
        });

        return;
      }

      if (section === undefined) {
        rejected.add(item[2]);
        fail({ file: 'log.md', message: `line ${line}: an item outside a known section` });

        return;
      }

      if (!MIGRATION_NAME_PATTERN.test(item[2])) {
        rejected.add(item[2]);
        fail({
          file: 'log.md',
          message: `line ${line}: item id '${item[2]}' must be lower-case words joined by '-'`,
        });

        return;
      }

      // The first of a repeated id stands: a second one would be a second chunk and record under the same id.
      if (seen.has(item[2])) {
        fail({ file: 'log.md', message: `item id '${item[2]}' is used twice (line ${line})` });

        return;
      }

      seen.add(item[2]);
      current = {
        id: item[2],
        title: item[1],
        section,
        packages: (item[3] ?? '')
          .split(',')
          .map((name) => name.replaceAll('`', '').trim())
          .filter((name) => name.length > 0),
        line,
        body: '',
      };
      currentLines = [text.replace(BULLET_LINE, '')];
      folder.items.push(current);
    });

    closeItem();
    folder.intro = introLines.join('\n').trim();
  }

  private static openSection(opts: {
    folder: IVersionFolder;
    name: string;
    previous: number;
    fail: TFail;
  }): void {
    const name = VersionSections.of({ name: opts.name });

    if (name === undefined) {
      opts.fail({
        file: 'log.md',
        message: `section '${opts.name}' is not one of ${VersionSections.ORDER.join(', ')}`,
      });

      return;
    }

    if (opts.folder.sections.includes(name)) {
      opts.fail({ file: 'log.md', message: `section '${name}' appears twice` });

      return;
    }

    if (VersionSections.ORDER.indexOf(name) < opts.previous) {
      opts.fail({
        file: 'log.md',
        message: `section '${name}' is out of order: ${VersionSections.ORDER.join(', ')}`,
      });
    }

    opts.folder.sections.push(name);
  }

  private static readMigration(opts: {
    folder: IVersionFolder;
    text: string;
    fail: TFail;
    rejected: Set<string>;
  }): void {
    let parsed: unknown;

    try {
      parsed = opts.text.trim() === '' ? {} : Bun.YAML.parse(opts.text);
    } catch (error) {
      opts.fail({
        file: 'migration.yaml',
        message: `invalid YAML: ${TextValue.messageOf({ error })}`,
      });

      return;
    }

    if (parsed !== null && (typeof parsed !== 'object' || Array.isArray(parsed))) {
      opts.fail({ file: 'migration.yaml', message: 'must be a map of item id to block' });

      return;
    }

    // The parser keeps the last of a repeated key: count the keys at the top level in the text.
    const counts = new Map<string, number>();

    for (const key of opts.text.matchAll(YAML_TOP_KEY)) {
      const name = (key[1] ?? key[2] ?? key[3]).trim();

      counts.set(name, (counts.get(name) ?? 0) + 1);
    }

    for (const [id, count] of counts) {
      if (count > 1) {
        opts.fail({
          file: 'migration.yaml',
          message: `id '${id}' is used ${count} times: an id is unique`,
        });
      }
    }

    for (const [id, value] of Object.entries(RecordValue.orEmpty({ value: parsed }))) {
      if (opts.rejected.has(id)) {
        continue;
      }

      if (!MIGRATION_NAME_PATTERN.test(id)) {
        opts.fail({
          file: 'migration.yaml',
          message: `id '${id}' must be lower-case words joined by '-'`,
        });

        continue;
      }

      const block = MigrationBlockSchema.safeParse(value);

      if (!block.success) {
        for (const issue of block.error.issues) {
          opts.fail({
            file: 'migration.yaml',
            message: `${id}.${issue.path.join('.')}: ${issue.message}`,
          });
        }

        continue;
      }

      opts.folder.blocks[id] = block.data;
    }
  }

  /** A block as a migration item, with its id: what the plan reads. */
  static itemOf(opts: { id: string; block: TMigrationBlock }): TMigrationItem {
    return { id: opts.id, ...opts.block };
  }
}
