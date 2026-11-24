import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProjectLayout } from '../common/index.ts';
import { ConfigFormat } from '../config/format.ts';
import type { ICheckContext } from './checks.ts';
import { DoctorChecks } from './common/index.ts';
import type { IViolation } from './common/index.ts';

export class ConfigOrderCheck {
  /** The keys of the config file that `vulcan config format` would move; nothing when it cannot order them. A note. */
  static check(opts: ICheckContext): IViolation[] {
    const result = ConfigFormat.format({
      text: readFileSync(join(opts.root, opts.configFile), 'utf8'),
      root: opts.root,
    });

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
