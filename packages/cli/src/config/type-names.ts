import { TypeScriptCompiler } from '@venizia/vulcan-atlas';
import { ConfigConstants } from './common/index.ts';
import type { IFileChange, TCodemodResult } from './codemod.ts';

const MODULES_DIRECTORY = `${ConfigConstants.DIRECTORY}/vulcan`;
/** The files of a config that can hold a `packages` entry: the config, and the modules a split writes (the groups and the earlier names). */
const MODULES = [
  'project',
  'agent',
  'guard',
  'board',
  'knowledge',
  'check',
  'common',
  'packages',
  'index',
];
/** The keys of a package entry (an object with a `dir` and a `name`) that are renamed. */
const PACKAGE_RENAMES: Readonly<Record<string, string>> = {
  kind: 'type',
  presetKind: 'presetType',
};
/** The keys of an acknowledgement of `check.doctor.privateValues.acknowledged` (an object with a `path` and a `reason`) that are renamed. */
const ACKNOWLEDGEMENT_RENAMES: Readonly<Record<string, string>> = { kinds: 'types' };

/**
 * The codemod `type-names`: a package entry of the config (`{ dir, name, kind: 'lib', presetKind: 'shared' }`, in the config, in a
 * module of a split config or in the `vulcan:apps` block) has `type` and `presetType`. An object is an entry when it has a `dir` and a
 * `name`; any other `kind` of the file is left alone.
 */
export class ConfigTypeNames {
  static readonly NAME = 'type-names';

  static run(opts: {
    root: string;
    /** The text of a file by path relative to `root`, or `undefined` when it is not there. */
    read: (path: string) => string | undefined;
  }): TCodemodResult {
    const typescript = TypeScriptCompiler.load({ from: opts.root });
    const paths = [
      `${ConfigConstants.DIRECTORY}/${ConfigConstants.FILE}`,
      ...MODULES.map((name) => `${MODULES_DIRECTORY}/${name}.mts`),
    ];
    const changes: IFileChange[] = [];
    const notes: string[] = [];

    for (const path of paths) {
      const text = opts.read(path);

      if (text === undefined) {
        continue;
      }

      const source = typescript.createSourceFile(
        path,
        text,
        typescript.ScriptTarget.Latest,
        true,
        typescript.ScriptKind.TS,
      );
      const edits: { start: number; end: number; text: string }[] = [];
      const visit = (node: Parameters<typeof typescript.forEachChild>[0]): void => {
        if (typescript.isObjectLiteralExpression(node)) {
          const keys = node.properties.flatMap((property) =>
            typescript.isPropertyAssignment(property) &&
            (typescript.isIdentifier(property.name) || typescript.isStringLiteral(property.name))
              ? [{ property, key: property.name.text }]
              : [],
          );
          const has = (name: string): boolean => keys.some(({ key }) => key === name);
          const renames =
            has('dir') && has('name')
              ? PACKAGE_RENAMES
              : has('path') && has('reason')
                ? ACKNOWLEDGEMENT_RENAMES
                : {};

          for (const { property, key } of keys) {
            const renamed = renames[key];

            if (renamed === undefined) {
              continue;
            }

            const quote = typescript.isStringLiteral(property.name)
              ? property.name.getText(source).slice(0, 1)
              : '';

            edits.push({
              start: property.name.getStart(source),
              end: property.name.getEnd(),
              text: `${quote}${renamed}${quote}`,
            });
          }
        }

        typescript.forEachChild(node, visit);
      };

      visit(source);

      if (edits.length === 0) {
        continue;
      }

      const renamed = edits
        .sort((left, right) => right.start - left.start)
        .reduce(
          (result, edit) => `${result.slice(0, edit.start)}${edit.text}${result.slice(edit.end)}`,
          text,
        );

      changes.push({ path, text: renamed });
      notes.push(
        `${path}: ${edits.length} key(s) renamed (kind to type, presetKind to presetType, kinds to types)`,
      );
    }

    return {
      ok: true,
      changes,
      notes:
        changes.length === 0
          ? ['no kind, presetKind or kinds key to rename: nothing to do']
          : notes,
    };
  }
}
