import { TypeScriptCompiler } from '@venizia/vulcan-atlas';
import { CodemodOutputBuilder } from './codemod-output.ts';
import { ConfigTypeRewriter } from './config-types-rewrite.ts';
import { CodemodConstants } from './common/index.ts';
import type { IFileChange, TCodemodResult } from './common/index.ts';

/**
 * The codemod `config-types`: the type names a config imports from `@venizia/vulcan`. The whole-file type `VulcanConfig` is
 * `VulcanConfigType`, the group types are `VulcanConfig.ProjectType` and so on, `TFlatConfig` is `TVulcanConfigInput` and
 * `TResolvedConfig` is `TVulcanConfigOutput`; `isReverse` puts the earlier names back. It reads the config and the modules of
 * `.configs/vulcan/`: the standard ones and every one those files import.
 */
export class ConfigTypesCodemod {
  static readonly NAME = 'config-types';

  static run(opts: {
    root: string;
    /** The text of a file by path relative to `root`, or `undefined` when it is not there. */
    read: (path: string) => string | undefined;
    isReverse?: boolean;
  }): TCodemodResult {
    const typescript = TypeScriptCompiler.load({ from: opts.root });
    const standard = [CodemodConstants.CONFIG_PATH, ...CodemodConstants.STANDARD_MODULE_PATHS];
    const reached = standard.flatMap((path) =>
      CodemodOutputBuilder.moduleFiles({
        typescript,
        source: typescript.createSourceFile(
          path,
          opts.read(path) ?? '',
          typescript.ScriptTarget.Latest,
          true,
          typescript.ScriptKind.TS,
        ),
        read: opts.read,
      }),
    );
    const changes: IFileChange[] = [];
    const notes: string[] = [];

    for (const path of new Set([...standard, ...reached])) {
      const text = opts.read(path);

      if (text === undefined) {
        continue;
      }

      const result = ConfigTypeRewriter.rewrite({
        typescript,
        path,
        text,
        isReverse: opts.isReverse,
      });

      notes.push(...result.notes.map((note) => `${path}: ${note}`));

      if (result.text !== text) {
        changes.push({ path, text: result.text });
        notes.push(`${path}: ${result.count} edit(s) to the config type names`);
      }
    }

    return {
      ok: true,
      changes,
      notes:
        changes.length === 0 && notes.length === 0
          ? ['no config type name to rename: nothing to do']
          : notes,
    };
  }
}
