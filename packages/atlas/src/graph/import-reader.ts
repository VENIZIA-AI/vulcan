import { TypeScriptCompiler } from '@/common/compiler';

export class ImportReader {
  /**
   * The module specifiers a file imports or re-exports, sorted and unique. Read with `preProcessFile`, which scans the
   * text and builds no program: `import`, `import type`, `export ... from` and `import x = require()`. A dynamic `import()`
   * and a `require()` call are not read in this version.
   */
  static specifiersOf(opts: { text: string }): string[] {
    const info = TypeScriptCompiler.get().preProcessFile(opts.text, true, false);
    const names = info.importedFiles.map((item) => item.fileName);

    return [...new Set(names)].sort();
  }
}
