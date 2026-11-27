import { TypeScriptCompiler } from '@venizia/vulcan-atlas';
import { CodemodConstants, ConfigConstants, ConfigKeyOrder } from './common/index.ts';
import type { TCodemodResult } from './common/index.ts';
import { CodemodItemReader } from './codemod-items.ts';
import { CodemodOutputBuilder } from './codemod-output.ts';
import { ConfigFormat } from './format.ts';

/**
 * The seven-group shape of a config file, from the flat one (the codemod `config-groups` of `vulcan config codemod`). The file is
 * read as text with TypeScript and never run: every value, comment and import stays as written; the properties move into their
 * groups, in the order of `ConfigKeyOrder`. With `split`, each group becomes a module `.configs/vulcan/<group>.mts` that the config
 * composes, and the modules of the old split are folded into them. A file the codemod cannot move without losing something is
 * refused with the reason, and nothing is written.
 */
export class ConfigCodemod {
  static readonly NAME = 'config-groups';

  static run(opts: {
    root: string;
    /** The text of a file by path relative to `root`, or `undefined` when it is not there. */
    read: (path: string) => string | undefined;
    split?: boolean;
  }): TCodemodResult {
    const text = opts.read(CodemodConstants.CONFIG_PATH);

    if (text === undefined) {
      return {
        ok: true,
        changes: [],
        notes: [`no ${CodemodConstants.CONFIG_PATH}: nothing to do`],
      };
    }

    const typescript = TypeScriptCompiler.load({ from: opts.root });
    const source = typescript.createSourceFile(
      ConfigConstants.FILE,
      text,
      typescript.ScriptTarget.Latest,
      true,
      typescript.ScriptKind.TS,
    );
    const found = ConfigFormat.findObject({ typescript, source });

    if ('reason' in found) {
      return { ok: false, reason: found.reason };
    }

    const keys: string[] = [];

    for (const property of found.object.properties) {
      const key = ConfigFormat.keyOf({ typescript, property });

      if (typeof key !== 'string') {
        return { ok: false, reason: key.reason };
      }

      keys.push(key);
    }

    if (keys.length === 0) {
      return { ok: true, changes: [], notes: ['the config has no key: nothing to do'] };
    }

    const cut = ConfigFormat.cut({ typescript, source, object: found.object, keys });

    if ('reason' in cut) {
      return { ok: false, reason: cut.reason };
    }

    const context = { typescript, source, object: found.object, keys, segments: cut.segments };
    const isFlat = ConfigKeyOrder.isFlatShape({ keys });

    if (!isFlat && opts.split !== true) {
      return { ok: true, changes: [], notes: ['the config is in groups already: nothing to do'] };
    }

    const items = isFlat
      ? CodemodItemReader.itemsOfFlat(context)
      : CodemodItemReader.itemsOfGrouped(context);

    if ('reason' in items) {
      return { ok: false, reason: items.reason };
    }

    return opts.split === true
      ? CodemodOutputBuilder.splitOutput({ opts, typescript, source, items: items.items })
      : CodemodOutputBuilder.singleOutput({
          opts,
          typescript,
          source,
          items: items.items,
          prefix: cut.prefix,
          suffix: cut.suffix,
        });
  }
}
