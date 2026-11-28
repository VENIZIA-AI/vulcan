/**
 * Snapshot of every exported symbol (values and types) of every package `exports` entry, read
 * from the built `.d.ts` with the TypeScript compiler API. Records name and kind only - never a
 * signature, generics, class members or a type body - so a fresh snapshot does not prove a
 * signature is unchanged. `check` fails when a symbol appears, disappears or changes kind. Usage:
 * vulcan atlas surface gen|check
 */
import { TypeScriptCompiler } from '@/common/compiler';
import { DeclarationProgram } from '@/common/declaration-program';
import { PackageEntries } from '@/common/package-entries';
import { ProjectConfig } from '@/common/project-config';
import { PROJECT_ROOT } from '@/common/project';
import type { IPackageEntries } from '@/common/types';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type TypeScript from 'typescript';

// Dependency order, so a diff reads bottom-up the way a release does.

interface IEntrySurface {
  entry: string;
  symbols: { name: string; category: string }[];
}

/** What `check` finds: the snapshot matches, differs from the built declarations, or was never committed. */
export class SurfaceVerdicts {
  static readonly FRESH = 'fresh';
  static readonly STALE = 'stale';
  static readonly MISSING = 'missing';
}

type TSurfaceVerdict = (typeof SurfaceVerdicts)[keyof typeof SurfaceVerdicts];

export class PublicSurface {
  /** The committed surface of the project. */
  static readonly OUTPUT = resolve(PROJECT_ROOT, '.agents/knowledge/reference/public-surface.md');

  static render(opts: { repoRoot?: string; packages?: string[] } = {}): string {
    const project = ProjectConfig.hasAtlasProject() ? ProjectConfig.readAtlasProject() : undefined;
    const repoRoot = opts.repoRoot ?? project?.root ?? PROJECT_ROOT;
    const packages =
      opts.packages ??
      ProjectConfig.livePackageDirs({ project: project ?? ProjectConfig.readAtlasProject() });
    const read = packages.map((dir) =>
      PackageEntries.readDirectory({
        directory: resolve(repoRoot, ProjectConfig.packagePathOf({ project, dir })),
        name: dir,
      }),
    );
    const program = DeclarationProgram.create({
      files: read.flatMap((item) => item.entries.map((entry) => entry.file)),
      scope: 'public-surface',
    });
    const sections = read.map((item) => PublicSurface.renderPackage({ program, read: item }));

    return [
      '---',
      'type: Reference',
      'title: Public surface',
      'description: Every exported symbol of every package exports entry, from the built .d.ts ' +
        '(generated).',
      'resource: packages',
      'tags: [reference, exports, api]',
      // okf gen owns no part of a file another generator writes: no contents list goes in here.
      'generated:',
      '  by: process:atlas-surface',
      '---',
      '',
      '> Generated from dist - do not edit; run `make surface-gen` after an intentional API ' +
        'change. A wave of the file split must leave this file untouched.',
      '',
      ...sections,
      '',
    ].join('\n');
  }

  /** Whether the committed snapshot matches the built declarations. A file that was never written is `missing`, not `stale`: there is no drift to look for. */
  static verdict(
    opts: { repoRoot?: string; packages?: string[]; outputPath?: string } = {},
  ): TSurfaceVerdict {
    const outputPath = opts.outputPath ?? PublicSurface.OUTPUT;

    if (!existsSync(outputPath)) {
      return SurfaceVerdicts.MISSING;
    }

    const expected = PublicSurface.render({ repoRoot: opts.repoRoot, packages: opts.packages });
    const actual = readFileSync(outputPath, 'utf8');

    return PublicSurface.normalize(expected) === PublicSurface.normalize(actual)
      ? SurfaceVerdicts.FRESH
      : SurfaceVerdicts.STALE;
  }

  static check(
    opts: { repoRoot?: string; packages?: string[]; outputPath?: string } = {},
  ): boolean {
    return PublicSurface.verdict(opts) === SurfaceVerdicts.FRESH;
  }

  private static renderPackage(opts: {
    program: DeclarationProgram;
    read: IPackageEntries;
  }): string {
    const { manifest } = opts.read;
    const surfaces = opts.read.entries.map((item) =>
      PublicSurface.surfaceOf({ program: opts.program, entry: item.subpath, file: item.file }),
    );
    const lines = surfaces.flatMap((surface) => {
      const suffix = surface.entry === '.' ? '' : surface.entry.slice(1);

      return [
        `### \`${manifest.name}${suffix}\` (${surface.symbols.length})`,
        '',
        ...surface.symbols.map((symbol) => `- \`${symbol.name}\` ${symbol.category}`),
        '',
      ];
    });

    return [`## ${opts.read.name}`, '', ...lines].join('\n');
  }

  private static surfaceOf(opts: {
    program: DeclarationProgram;
    entry: string;
    file: string;
  }): IEntrySurface {
    const { checker, moduleSymbol } = opts.program.moduleOf({ file: opts.file });

    const symbols = checker
      .getExportsOfModule(moduleSymbol)
      .map((symbol) => ({
        name: symbol.getName(),
        category: PublicSurface.categoryOf({ checker, symbol }),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));

    return { entry: opts.entry, symbols };
  }

  /** Public so `atlas-symbols.ts` records the same vocabulary this snapshot does, never a second one. */
  static categoryOf(opts: { checker: TypeScript.TypeChecker; symbol: TypeScript.Symbol }): string {
    const resolved =
      opts.symbol.flags & TypeScriptCompiler.get().SymbolFlags.Alias
        ? opts.checker.getAliasedSymbol(opts.symbol)
        : opts.symbol;
    const flags = resolved.flags;

    if (flags & TypeScriptCompiler.get().SymbolFlags.Class) {
      return 'class';
    }

    if (flags & TypeScriptCompiler.get().SymbolFlags.Interface) {
      return 'interface';
    }

    if (flags & TypeScriptCompiler.get().SymbolFlags.TypeAlias) {
      return 'type';
    }

    if (flags & TypeScriptCompiler.get().SymbolFlags.Enum) {
      return 'enum';
    }

    if (flags & TypeScriptCompiler.get().SymbolFlags.Function) {
      return 'function';
    }

    if (flags & TypeScriptCompiler.get().SymbolFlags.Variable) {
      return 'const';
    }

    if (flags & TypeScriptCompiler.get().SymbolFlags.Module) {
      return 'namespace';
    }

    return 'other';
  }

  private static normalize(text: string): string {
    return text
      .split('\n')
      .map((line) => line.replace(/\s+$/, ''))
      .join('\n')
      .trim();
  }
}
