import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { z } from 'zod';
import { RecordValue } from '@/common/record';
import { TextValue } from '@/common/text';
import { MIGRATION_NAME_PATTERN, MigrationItemSchema } from '@/migrations/schema';
import type { TMigrationItem } from '@/migrations/schema';
import { Resolve } from './resolve';

/** The sections of a version's `log.md`, in the order they must appear. */
export class VersionSections {
  static readonly BREAKING = 'Breaking';
  static readonly DEPRECATED = 'Deprecated';
  static readonly ADDED = 'Added';
  static readonly CHANGED = 'Changed';
  static readonly FIXED = 'Fixed';
  static readonly SECURITY = 'Security';
  static readonly ORDER = [
    VersionSections.BREAKING,
    VersionSections.DEPRECATED,
    VersionSections.ADDED,
    VersionSections.CHANGED,
    VersionSections.FIXED,
    VersionSections.SECURITY,
  ];
  /** The sections whose items owe a block in `migration.yaml`. */
  static readonly OWING = [VersionSections.BREAKING, VersionSections.DEPRECATED];
}

/** A block of `migration.yaml`: an item of the migration schema without its id, which is the key. */
export const MigrationBlockSchema = MigrationItemSchema.omit({ id: true });

export type TMigrationBlock = z.infer<typeof MigrationBlockSchema>;

/** One item of a `log.md`: `- **Title** \`id\` (\`@pkg\`): prose`. */
export interface IVersionItem {
  id: string;
  title: string;
  section: string;
  /** The packages named after the id; empty when the item belongs to the file's packages. */
  packages: string[];
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
  sections: string[];
  items: IVersionItem[];
  /** The blocks of `migration.yaml` by item id; empty when the file is absent or `{}`. */
  blocks: Record<string, unknown>;
  /** Everything wrong with the folder that parsing can see; the gate adds the rules that need the project. */
  problems: IVersionProblem[];
}

const FOLDER_NAME = /^\d+\.\d+\.\d+$/;
const ITEM_LINE = /^- \*\*(.+?)\*\* `([^`]+)`(?: \(([^)]*)\))?/;
const SECTION_LINE = /^## (.+?)\s*$/;
const RELEASED_DATE = /^\d{4}-\d{2}-\d{2}$/;

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
    const fail = (file: string, message: string): void => {
      folder.problems.push({ file: `${opts.name}/${file}`, message });
    };

    if (!existsSync(logFile)) {
      fail('log.md', 'a version folder needs a log.md');
    } else {
      VersionFolders.readLog({ folder, text: readFileSync(logFile, 'utf8'), fail });
    }

    if (existsSync(migrationFile)) {
      VersionFolders.readMigration({ folder, text: readFileSync(migrationFile, 'utf8'), fail });
    }

    return folder;
  }

  private static readLog(opts: {
    folder: IVersionFolder;
    text: string;
    fail: (file: string, message: string) => void;
  }): void {
    const { folder, fail } = opts;
    let data: Record<string, unknown>;
    let body: string;

    try {
      ({ data, body } = Resolve.splitFrontmatter(opts.text));
    } catch (error) {
      fail('log.md', `invalid frontmatter: ${TextValue.messageOf({ error })}`);

      return;
    }

    const version = typeof data.version === 'string' ? data.version : undefined;

    if (version !== folder.name) {
      fail('log.md', `version: must be '${folder.name}', the name of the folder`);
    } else {
      folder.version = version;
    }

    folder.packages = stringsOf({ value: data.packages });

    if (data.released !== undefined) {
      const released = typeof data.released === 'string' ? data.released : '';

      if (RELEASED_DATE.test(released)) {
        folder.released = released;
      } else {
        fail('log.md', 'released: must be a date, YYYY-MM-DD');
      }
    }

    let section: string | undefined;
    let previous = -1;
    const seen = new Set<string>();

    body.split('\n').forEach((text, index) => {
      const heading = SECTION_LINE.exec(text);

      if (heading !== null) {
        VersionFolders.openSection({ folder, name: heading[1], previous, fail });

        const at = VersionSections.ORDER.indexOf(heading[1]);

        section = at === -1 ? undefined : heading[1];
        previous = at === -1 ? previous : at;

        return;
      }

      const item = ITEM_LINE.exec(text);

      if (item === null) {
        return;
      }

      if (section === undefined) {
        fail('log.md', `line ${index + 1}: an item outside a known section`);

        return;
      }

      if (!MIGRATION_NAME_PATTERN.test(item[2])) {
        fail(
          'log.md',
          `line ${index + 1}: item id '${item[2]}' must be lower-case words joined by '-'`,
        );

        return;
      }

      if (seen.has(item[2])) {
        fail('log.md', `item id '${item[2]}' is used twice (line ${index + 1})`);
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
        line: index + 1,
      });
    });
  }

  private static openSection(opts: {
    folder: IVersionFolder;
    name: string;
    previous: number;
    fail: (file: string, message: string) => void;
  }): void {
    const at = VersionSections.ORDER.indexOf(opts.name);

    if (at === -1) {
      opts.fail(
        'log.md',
        `section '${opts.name}' is not one of ${VersionSections.ORDER.join(', ')}`,
      );

      return;
    }

    if (opts.folder.sections.includes(opts.name)) {
      opts.fail('log.md', `section '${opts.name}' appears twice`);

      return;
    }

    if (at < opts.previous) {
      opts.fail(
        'log.md',
        `section '${opts.name}' is out of order: ${VersionSections.ORDER.join(', ')}`,
      );
    }

    opts.folder.sections.push(opts.name);
  }

  private static readMigration(opts: {
    folder: IVersionFolder;
    text: string;
    fail: (file: string, message: string) => void;
  }): void {
    let parsed: unknown;

    try {
      parsed = opts.text.trim() === '' ? {} : Bun.YAML.parse(opts.text);
    } catch (error) {
      opts.fail('migration.yaml', `invalid YAML: ${TextValue.messageOf({ error })}`);

      return;
    }

    if (parsed !== null && (typeof parsed !== 'object' || Array.isArray(parsed))) {
      opts.fail('migration.yaml', 'must be a map of item id to block');

      return;
    }

    const counts = new Map<string, number>();

    for (const key of opts.text.matchAll(/^([^\s#-][^:\n]*):/gm)) {
      counts.set(key[1], (counts.get(key[1]) ?? 0) + 1);
    }

    for (const [id, count] of counts) {
      if (count > 1) {
        opts.fail('migration.yaml', `id '${id}' is used ${count} times: an id is unique`);
      }
    }

    for (const [id, value] of Object.entries(RecordValue.orEmpty({ value: parsed }))) {
      if (!MIGRATION_NAME_PATTERN.test(id)) {
        opts.fail('migration.yaml', `id '${id}' must be lower-case words joined by '-'`);

        continue;
      }

      const block = MigrationBlockSchema.safeParse(value);

      if (!block.success) {
        for (const issue of block.error.issues) {
          opts.fail('migration.yaml', `${id}.${issue.path.join('.')}: ${issue.message}`);
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
