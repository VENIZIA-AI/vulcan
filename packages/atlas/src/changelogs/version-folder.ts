import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { z } from 'zod';
import type { TConstValue } from '@/common/types';
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
  /** Sections in the order they appear. */
  sections: TVersionSection[];
  items: IVersionItem[];
  /** The blocks of `migration.yaml` by item id; empty when the file is absent or `{}`. */
  blocks: Record<string, unknown>;
  /** Everything wrong with the folder that parsing can see; the gate adds the rules that need the project. */
  problems: IVersionProblem[];
}

type TFail = (opts: { file: string; message: string }) => void;

const FOLDER_NAME = /^\d+\.\d+\.\d+$/;
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
    return FOLDER_NAME.test(opts.name);
  }

  /** The version folders of `directory`, oldest first; a directory that is not there has none. */
  static read(opts: { directory: string }): IVersionFolder[] {
    if (!existsSync(opts.directory)) {
      return [];
    }

    return readdirSync(opts.directory)
      .filter(
        (name) => FOLDER_NAME.test(name) && statSync(join(opts.directory, name)).isDirectory(),
      )
      .sort((left, right) => Bun.semver.order(left, right))
      .map((name) => VersionFolders.readOne({ directory: opts.directory, name }));
  }

  static readOne(opts: { directory: string; name: string }): IVersionFolder {
    const folder: IVersionFolder = {
      name: opts.name,
      packages: [],
      sections: [],
      items: [],
      blocks: {},
      problems: [],
    };
    const logFile = join(opts.directory, opts.name, 'log.md');
    const migrationFile = join(opts.directory, opts.name, 'migration.yaml');
    const fail: TFail = ({ file, message }) => {
      folder.problems.push({ file: `${opts.name}/${file}`, message });
    };

    if (existsSync(logFile)) {
      VersionFolders.readLog({ folder, text: readFileSync(logFile, 'utf8'), fail });
    } else {
      fail({ file: 'log.md', message: 'a version folder needs a log.md' });
    }

    if (existsSync(migrationFile)) {
      VersionFolders.readMigration({ folder, text: readFileSync(migrationFile, 'utf8'), fail });
    }

    return folder;
  }

  private static readLog(opts: { folder: IVersionFolder; text: string; fail: TFail }): void {
    const { folder, fail } = opts;
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
        fail({ file: 'log.md', message: 'released: must be a date, YYYY-MM-DD' });
      }
    }

    // The lines of the body start after the frontmatter: a message names the line of the file.
    const offset = opts.text.split('\n').length - body.split('\n').length;
    let section: TVersionSection | undefined;
    let previous = -1;
    const seen = new Set<string>();

    body.split('\n').forEach((text, index) => {
      const line = index + 1 + offset;
      const heading = SECTION_LINE.exec(text);

      if (heading !== null) {
        const known = VersionSections.of({ name: heading[1] });

        VersionFolders.openSection({ folder, name: heading[1], previous, fail });
        section = known;
        previous = known === undefined ? previous : VersionSections.ORDER.indexOf(known);

        return;
      }

      if (!BULLET_LINE.test(text)) {
        return;
      }

      const item = ITEM_LINE.exec(text);

      if (item === null) {
        fail({
          file: 'log.md',
          message: `line ${line}: an item reads "- **Title** \`item-id\`: prose"`,
        });

        return;
      }

      if (section === undefined) {
        fail({ file: 'log.md', message: `line ${line}: an item outside a known section` });

        return;
      }

      if (!MIGRATION_NAME_PATTERN.test(item[2])) {
        fail({
          file: 'log.md',
          message: `line ${line}: item id '${item[2]}' must be lower-case words joined by '-'`,
        });

        return;
      }

      if (seen.has(item[2])) {
        fail({ file: 'log.md', message: `item id '${item[2]}' is used twice (line ${line})` });
      }

      seen.add(item[2]);
      folder.items.push({
        id: item[2],
        title: item[1],
        section,
        packages: (item[3] ?? '')
          .split(',')
          .map((name) => name.replaceAll('`', '').trim())
          .filter((name) => name.length > 0),
        line,
      });
    });
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

  private static readMigration(opts: { folder: IVersionFolder; text: string; fail: TFail }): void {
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
