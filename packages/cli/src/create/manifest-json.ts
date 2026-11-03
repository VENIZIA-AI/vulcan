import { BunFormatter } from '../common/index.ts';

export class ManifestJson {
  /** A package.json as `bun fmt` wants it: Bun's own key order (name, version, ... scripts, dependencies A to Z). */
  static render(opts: { value: unknown }): string {
    return BunFormatter.format({
      text: `${JSON.stringify(opts.value, null, 2)}\n`,
      file: 'package.json',
    });
  }
}
