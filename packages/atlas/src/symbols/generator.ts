#!/usr/bin/env bun
/**
 * Symbol table for the Atlas `symbol` tool: every exported symbol of every package `exports`
 * entry, with the kind `public-surface.ts` records plus a one-line signature and the `file:line`
 * of the declaration in `src/`. Read from the built `.d.ts`, so the packages must be built first.
 * Usage: bun scripts/atlas-symbols.ts gen|check
 */
import { TypeScriptCompiler } from '@/common/compiler';
import { DeclarationProgram } from '@/common/declaration-program';
import { readPackageDirectory } from '@/common/package-entries';
import type { IPackageMapEntry } from '@/common/package-map';
import type { IPackageEntries } from '@/common/types';
import { hasAtlasProject, livePackageDirs, readAtlasProject } from '@/common/project-config';
import { PROJECT_ROOT } from '@/common/project';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import type TypeScript from 'typescript';
import { PublicSurface } from '@/surface';

export const SYMBOLS_OUTPUT = resolve(PROJECT_ROOT, '.agents/knowledge/reference/symbols.json');

const SIGNATURE_MAX_CHARS = 300;

/** One exported symbol, located in the source it was written in - never in the `dist` it was read from. */
export interface ISymbolRecord {
  name: string;
  package: string;
  subpath: string;
  specifier: string;
  kind: string;
  file: string;
  line: number;
  signature: string;
  /** Present and true when `file` points inside `node_modules`: the export re-exports a third-party declaration, so the path is an install detail, not repository source. */
  external?: boolean;
}

export interface ISymbolTable {
  generatedFrom: string;
  packages: string[];
  symbols: ISymbolRecord[];
  packageMap: IPackageMapEntry[];
}

interface ILocation {
  file: string;
  line: number;
}

/** One decoded source-map segment: where a generated column came from in the original source. */
interface IMappingSegment {
  generatedColumn: number;
  sourceIndex: number;
  sourceLine: number;
  sourceColumn: number;
}

interface IDeclarationMap {
  sources: string[];
  lines: IMappingSegment[][];
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_INDEX = new Map<string, number>(
  BASE64_ALPHABET.split('').map((char, at) => [char, at]),
);

const CONTINUATION_BIT = 32;
const VALUE_MASK = 31;

/** One base64 VLQ field: five value bits per character, the sixth marking "another character follows". */
const decodeField = (opts: { text: string; at: number }): { value: number; at: number } => {
  let { at } = opts;
  let shift = 0;
  let value = 0;
  let digit = CONTINUATION_BIT;

  while ((digit & CONTINUATION_BIT) !== 0 && at < opts.text.length) {
    digit = BASE64_INDEX.get(opts.text[at]) ?? 0;
    at += 1;
    value += (digit & VALUE_MASK) * Math.pow(2, shift);
    shift += 5;
  }

  const negative = (value & 1) === 1;
  const magnitude = Math.floor(value / 2);

  return { value: negative ? -magnitude : magnitude, at };
};

/**
 * The `mappings` field, one array per generated line. Only `generatedColumn` restarts on a new
 * line; the source index, line and column accumulate across the whole string.
 */
const decodeMappings = (mappings: string): IMappingSegment[][] => {
  let sourceIndex = 0;
  let sourceLine = 0;
  let sourceColumn = 0;

  return mappings.split(';').map(line => {
    const segments: IMappingSegment[] = [];
    let generatedColumn = 0;

    const fields = line.split(',');

    for (const field of fields) {
      if (field.length === 0) {
        continue;
      }

      const values: number[] = [];
      let at = 0;

      while (at < field.length) {
        const decoded = decodeField({ text: field, at });

        values.push(decoded.value);
        at = decoded.at;
      }

      generatedColumn += values[0] ?? 0;

      if (values.length < 4) {
        continue;
      }

      sourceIndex += values[1];
      sourceLine += values[2];
      sourceColumn += values[3];
      segments.push({ generatedColumn, sourceIndex, sourceLine, sourceColumn });
    }

    return segments;
  });
};

/** Windows separators never reach a generated file - every recorded path is POSIX. */
const toPosix = (path: string): string => path.split('\\').join('/');

const repoRelative = (opts: { repoRoot: string; path: string }): string =>
  toPosix(relative(opts.repoRoot, opts.path));

/** The declaration node whose name the record is filed under; a node with no name locates itself. */
const namedNodeOf = (declaration: TypeScript.Declaration): TypeScript.Node =>
  TypeScriptCompiler.get().getNameOfDeclaration(declaration) ?? declaration;

export class AtlasSymbols {
  private static readonly maps = new Map<string, IDeclarationMap | undefined>();

  static render(opts: { repoRoot?: string; packages?: string[] } = {}): string {
    const project = hasAtlasProject() ? readAtlasProject() : undefined;
    const repoRoot = opts.repoRoot ?? project?.root ?? PROJECT_ROOT;
    const packages = opts.packages ?? livePackageDirs({ project: project ?? readAtlasProject() });
    // Each package where the manifest says it lives (an application keeps them outside packages/).
    const pathOf = (dir: string): string =>
      project?.packages.find(entry => entry.dir === dir)?.path ?? `packages/${dir}`;
    const read = packages.map(dir =>
      readPackageDirectory({ directory: resolve(repoRoot, pathOf(dir)), name: dir }),
    );
    const table: ISymbolTable = {
      generatedFrom: 'dist',
      packages,
      symbols: AtlasSymbols.recordsOf({ repoRoot, packages: read }),
      // The names a tool may be asked by: each package's npm name, from its manifest, and its aliases.
      packageMap: packages.map((dir, index) => ({
        dir,
        name: read[index].manifest.name,
        aliases: project?.packages.find(entry => entry.dir === dir)?.aliases ?? [],
      })),
    };

    return `${JSON.stringify(table, null, 2)}\n`;
  }

  /**
   * Every exported symbol of the given packages' `exports` entries, sorted - read from their
   * declaration files, wherever the packages live. Paths are relative to `repoRoot`.
   */
  static recordsOf(opts: { repoRoot: string; packages: IPackageEntries[] }): ISymbolRecord[] {
    const program = DeclarationProgram.create({
      files: opts.packages.flatMap(item => item.entries.map(entry => entry.file)),
      scope: 'atlas-symbols',
    });

    return opts.packages
      .flatMap(item =>
        item.entries.flatMap(entry =>
          AtlasSymbols.entrySymbolsOf({
            program,
            repoRoot: opts.repoRoot,
            packageName: item.manifest.name,
            subpath: entry.subpath,
            file: entry.file,
          }),
        ),
      )
      .sort(AtlasSymbols.compare);
  }

  static check(
    opts: { repoRoot?: string; packages?: string[]; outputPath?: string } = {},
  ): boolean {
    const outputPath = opts.outputPath ?? SYMBOLS_OUTPUT;
    const expected = AtlasSymbols.render({ repoRoot: opts.repoRoot, packages: opts.packages });
    const actual = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : '';

    return expected.trim() === actual.trim();
  }

  /** `packages/x/dist/cjs/y.d.ts` (or `dist/esm`, or a flat `dist`) as `packages/x/src/y.ts`; `undefined` when the path has no `dist` segment at all. */
  static sourcePathOf(opts: { distPath: string }): string | undefined {
    const matched = opts.distPath.match(/^(.*)\/dist\/(?:cjs\/|esm\/)?(.*)$/);

    if (!matched) {
      return undefined;
    }

    return `${matched[1]}/src/${matched[2].replace(/\.d\.ts$/, '.ts')}`;
  }

  /** One line, whitespace collapsed, no `export`/`declare` modifier, no trailing semicolon, at most 300 characters. */
  static collapseSignature(opts: { text: string }): string {
    const collapsed = opts.text
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^export\s+/, '')
      .replace(/^declare\s+/, '')
      .replace(/;$/, '')
      .trim();

    return collapsed.length > SIGNATURE_MAX_CHARS
      ? collapsed.slice(0, SIGNATURE_MAX_CHARS)
      : collapsed;
  }

  /** Package, then subpath, then name - code-point order, so the file is byte-identical on every machine. */
  private static compare(left: ISymbolRecord, right: ISymbolRecord): number {
    const keyOf = (record: ISymbolRecord): string =>
      `${record.package}\u0000${record.subpath}\u0000${record.name}`;
    const leftKey = keyOf(left);
    const rightKey = keyOf(right);

    if (leftKey === rightKey) {
      return 0;
    }

    return leftKey < rightKey ? -1 : 1;
  }

  private static entrySymbolsOf(opts: {
    program: DeclarationProgram;
    repoRoot: string;
    packageName: string;
    subpath: string;
    file: string;
  }): ISymbolRecord[] {
    const { repoRoot, packageName, subpath, file } = opts;
    const { checker, moduleSymbol } = opts.program.moduleOf({ file });

    const specifier = subpath === '.' ? packageName : `${packageName}${subpath.slice(1)}`;
    const exported = checker.getExportsOfModule(moduleSymbol);

    return exported.map(symbol => {
      const resolved =
        symbol.flags & TypeScriptCompiler.get().SymbolFlags.Alias
          ? checker.getAliasedSymbol(symbol)
          : symbol;
      const declaration = resolved.getDeclarations()?.[0];
      const location = declaration
        ? AtlasSymbols.locationOf({ repoRoot, declaration })
        : { file: repoRelative({ repoRoot, path: file }), line: 1 };

      const record: ISymbolRecord = {
        name: symbol.getName(),
        package: packageName,
        subpath,
        specifier,
        kind: PublicSurface.kindOf({ checker, symbol }),
        file: location.file,
        line: location.line,
        signature: declaration
          ? AtlasSymbols.collapseSignature({ text: AtlasSymbols.signatureOf({ declaration }) })
          : '',
      };

      return location.file.includes('node_modules') ? { ...record, external: true } : record;
    });
  }

  /**
   * The declaration map wins - it names the source file and the exact line the compiler emitted
   * from. Without one, path arithmetic maps `dist` onto `src` and keeps the `.d.ts` line; when
   * even that source file is missing, the `dist`-relative path stays, never a guessed source.
   */
  private static locationOf(opts: {
    repoRoot: string;
    declaration: TypeScript.Declaration;
  }): ILocation {
    const { repoRoot, declaration } = opts;
    const sourceFile = declaration.getSourceFile();
    const start = namedNodeOf(declaration).getStart(sourceFile);
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(start);

    const mapped = AtlasSymbols.mappedLocationOf({
      repoRoot,
      declarationPath: sourceFile.fileName,
      line,
      character,
    });

    if (mapped) {
      return mapped;
    }

    const distPath = repoRelative({ repoRoot, path: sourceFile.fileName });
    const sourcePath = AtlasSymbols.sourcePathOf({ distPath });

    if (sourcePath && existsSync(resolve(repoRoot, sourcePath))) {
      return { file: sourcePath, line: line + 1 };
    }

    return { file: distPath, line: line + 1 };
  }

  private static mappedLocationOf(opts: {
    repoRoot: string;
    declarationPath: string;
    line: number;
    character: number;
  }): ILocation | undefined {
    const map = AtlasSymbols.declarationMapOf({ path: `${opts.declarationPath}.map` });
    const segments = map?.lines[opts.line];

    if (!map || !segments || segments.length === 0) {
      return undefined;
    }

    // The last segment starting at or before the name's column; a name inside a segment shares it.
    const covering = segments.filter(segment => segment.generatedColumn <= opts.character);
    const segment = covering[covering.length - 1] ?? segments[0];
    const sourceName = map.sources[segment.sourceIndex];

    if (sourceName === undefined) {
      return undefined;
    }

    const sourcePath = resolve(dirname(opts.declarationPath), sourceName);

    if (!existsSync(sourcePath)) {
      return undefined;
    }

    return {
      file: repoRelative({ repoRoot: opts.repoRoot, path: sourcePath }),
      line: segment.sourceLine + 1,
    };
  }

  /** Decoded once per `.d.TypeScriptCompiler.get().map`: one package's entry re-reads the same map for hundreds of symbols. */
  private static declarationMapOf(opts: { path: string }): IDeclarationMap | undefined {
    if (AtlasSymbols.maps.has(opts.path)) {
      return AtlasSymbols.maps.get(opts.path);
    }

    const decoded = existsSync(opts.path)
      ? AtlasSymbols.decodeDeclarationMap({ path: opts.path })
      : undefined;

    AtlasSymbols.maps.set(opts.path, decoded);

    return decoded;
  }

  private static decodeDeclarationMap(opts: { path: string }): IDeclarationMap | undefined {
    const parsed: { sources?: string[]; mappings?: string } = JSON.parse(
      readFileSync(opts.path, 'utf8'),
    );

    if (!parsed.sources || parsed.mappings === undefined) {
      return undefined;
    }

    return { sources: parsed.sources, lines: decodeMappings(parsed.mappings) };
  }

  /**
   * The declaration without its body: a class or interface keeps its heritage clause, a type alias
   * and an enum keep their head, everything else is already bodiless in a `.d.ts`.
   */
  private static signatureOf(opts: { declaration: TypeScript.Declaration }): string {
    const { declaration } = opts;
    const sourceFile = declaration.getSourceFile();
    const textOf = (node?: TypeScript.Node): string => (node ? node.getText(sourceFile) : '');
    const parametersOf = (
      parameters?: TypeScript.NodeArray<TypeScript.TypeParameterDeclaration>,
    ): string =>
      parameters && parameters.length > 0 ? `<${parameters.map(textOf).join(', ')}>` : '';

    if (
      TypeScriptCompiler.get().isClassDeclaration(declaration) ||
      TypeScriptCompiler.get().isInterfaceDeclaration(declaration)
    ) {
      const keyword = TypeScriptCompiler.get().isClassDeclaration(declaration)
        ? 'class'
        : 'interface';
      const heritage = (declaration.heritageClauses ?? []).map(textOf).join(' ');
      const head = `${keyword} ${textOf(declaration.name)}${parametersOf(declaration.typeParameters)}`;

      return heritage.length > 0 ? `${head} ${heritage}` : head;
    }

    if (TypeScriptCompiler.get().isTypeAliasDeclaration(declaration)) {
      // The right-hand side IS the alias; without it a record says nothing `kind` did not.
      const head = `type ${textOf(declaration.name)}${parametersOf(declaration.typeParameters)}`;

      return `${head} = ${textOf(declaration.type)}`;
    }

    if (TypeScriptCompiler.get().isEnumDeclaration(declaration)) {
      return `enum ${textOf(declaration.name)}`;
    }

    if (TypeScriptCompiler.get().isModuleDeclaration(declaration)) {
      return `namespace ${textOf(declaration.name)}`;
    }

    return textOf(declaration);
  }
}

/** A debug view: atlas reads declarations when asked (D2); no project commits a symbol table. */
export const runSymbolsCommand = (opts: { command?: string }): number => {
  if (opts.command === 'gen' || opts.command === 'check') {
    console.error(
      `vulcan x atlas symbols ${opts.command}: gone in 0.2.0-0 - atlas reads the installed or built .d.ts when asked; delete .agents/knowledge/reference/symbols.json, and \`vulcan x atlas symbols\` prints what it reads`,
    );

    return 2;
  }

  process.stdout.write(AtlasSymbols.render());

  return 0;
};
