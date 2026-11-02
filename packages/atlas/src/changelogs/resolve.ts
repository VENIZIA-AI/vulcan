import { PackageMap } from '@/common/package-map';
import type { IAtlasPackage } from '@/common/project-config';
import { RecordValue } from '@/common/record';
import { TextValue } from '@/common/text';
import { FRONTMATTER_PATTERN } from '@/corpus/frontmatter';

export class Resolve {
  static resolveAll(opts: { values: string[]; packages: IAtlasPackage[] }): string[] {
    const resolved = opts.values
      .map((value) => PackageMap.directoryOf({ value, packages: opts.packages }))
      .filter((name): name is string => name !== undefined);

    return [...new Set(resolved)].sort((left, right) => TextValue.compare({ left, right }));
  }

  static splitFrontmatter(text: string): { data: Record<string, unknown>; body: string } {
    const matched = text.match(FRONTMATTER_PATTERN);

    if (!matched) {
      return { data: {}, body: text };
    }

    const parsed: unknown = Bun.YAML.parse(matched[1]);

    return { data: RecordValue.orEmpty({ value: parsed }), body: text.slice(matched[0].length) };
  }
}
