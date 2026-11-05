import { TypeScriptCompiler } from '@/common/compiler';

export class ImportReader {
  /**
   * The module specifiers a file imports or re-exports, sorted and unique. Read with `preProcessFile`, which scans the
   * text and builds no program: `import`, `import type`, `export ... from`, `import x = require()` and a dynamic
   * `import('./x')` with a string literal. A `require()` call and an import whose specifier is computed are not read.
   */
  static specifiersOf(opts: { text: string }): string[] {
    const info = TypeScriptCompiler.get().preProcessFile(opts.text, true, false);
    const names = info.importedFiles.map((item) => item.fileName);

    return [...new Set(names)].sort();
  }
}
