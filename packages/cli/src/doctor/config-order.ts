import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProjectLayout } from '../common/index.ts';
import { ConfigKeyOrder } from '../config/common/index.ts';
import { ConfigFormat } from '../config/format.ts';
import type { ICheckContext } from './checks.ts';
import { DoctorChecks } from './common/index.ts';
import type { IViolation } from './common/index.ts';

export class ConfigOrderCheck {
  /**
   * The keys of the config file that `vulcan config format` would move; nothing when it cannot order them. The keys of the
   * loaded object are read first, so a config in order never loads the compiler. A note.
   */
  static check(opts: ICheckContext): IViolation[] {
    if (
      opts.layers !== undefined &&
      ConfigKeyOrder.isOrdered({ keys: Object.keys(opts.layers.project) })
    ) {
      return [];
    }

    let result;

    try {
      result = ConfigFormat.format({
        text: readFileSync(join(opts.root, opts.configFile), 'utf8'),
        root: opts.root,
      });
    } catch (error) {
      return [
        {
          check: DoctorChecks.CONFIG_ORDER,
          file: opts.configFile,
          message: `the order of the keys was not checked: ${error instanceof Error ? error.message : String(error)}`,
        },
      ];
    }

    return !result.ok || result.moved.length === 0
      ? []
      : [
          {
            check: DoctorChecks.CONFIG_ORDER,
            file: opts.configFile,
            message: `${result.moved.length} key(s) out of the canonical order (${result.moved.join(', ')}): run \`${ProjectLayout.VULCAN_COMMAND} config format\``,
          },
        ];
  }
}
