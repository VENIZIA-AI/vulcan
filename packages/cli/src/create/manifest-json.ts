import { formatWithBun } from '../common/index.ts';

/** A package.json as `bun fmt` wants it: Bun's own key order (name, version, ... scripts, dependencies A to Z). */
export const renderManifestJson = (opts: { value: unknown }): string =>
  formatWithBun({ text: `${JSON.stringify(opts.value, null, 2)}\n`, file: 'package.json' });
