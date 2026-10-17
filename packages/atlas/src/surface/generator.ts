/**
 * Snapshot of every exported symbol (values and types) of every package `exports` entry, read
 * from the built `.d.ts` with the TypeScript compiler API. Records name and kind only - never a
 * signature, generics, class members or a type body - so a fresh snapshot does not prove a
 * signature is unchanged. `check` fails when a symbol appears, disappears or changes kind. Usage:
 * bun scripts/public-surface.ts gen|check
 */
import { TypeScriptCompiler } from '@/common/compiler';
import { DeclarationProgram } from '@/common/declaration-program';
import { readPackageEntries } from '@/common/package-entries';
import { regenerateHintOf } from '@/common/regenerate-hint';
import { readAtlasPackages } from '@/common/project-config';
import { PROJECT_ROOT } from '@/common/project';
import type { IPackageEntries } from '@/common/types';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type TypeScript from 'typescript';

const OUTPUT = resolve(PROJECT_ROOT, '.agents/knowledge/reference/public-surface.md');
// Dependency order, so a diff reads bottom-up the way a release does.

interface IEntrySurface {
  entry: string;
  symbols: { name: string; kind: string }[];
}

export class PublicSurface {
  static render(opts: { repoRoot?: string; packages?: string[] } = {}): string {
    const repoRoot = opts.repoRoot ?? PROJECT_ROOT;
    const packages = opts.packages ?? readAtlasPackages({ repoRoot });
    const read = packages.map(name => readPackageEntries({ repoRoot, name }));
    const program = DeclarationProgram.create({
      files: read.flatMap(item => item.entries.map(entry => entry.file)),
      scope: 'public-surface',
    });
    const sections = read.map(item => PublicSurface.renderPackage({ program, read: item }));

    return [
      '---',
      'type: Reference',
      'title: Public surface',
      'description: Every exported symbol of every package exports entry, from the built .d.ts ' +
        '(generated).',
      'resource: packages',
      'tags: [reference, exports, api]',
      '---',
      '',
      '> Generated from dist - do not edit; run `make surface-gen` after an intentional API ' +
        'change. A wave of the file split must leave this file untouched.',
      '',
      ...sections,
      '',
    ].join('\n');
  }

  static check(
    opts: { repoRoot?: string; packages?: string[]; outputPath?: string } = {},
  ): boolean {
    const outputPath = opts.outputPath ?? OUTPUT;
    const expected = PublicSurface.render({ repoRoot: opts.repoRoot, packages: opts.packages });
    const actual = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : '';

    return PublicSurface.normalize(expected) === PublicSurface.normalize(actual);
  }

  private static renderPackage(opts: {
    program: DeclarationProgram;
    read: IPackageEntries;
  }): string {
    const { manifest } = opts.read;
    const surfaces = opts.read.entries.map(item =>
      PublicSurface.surfaceOf({ program: opts.program, entry: item.subpath, file: item.file }),
    );
    const lines = surfaces.flatMap(surface => {
      const suffix = surface.entry === '.' ? '' : surface.entry.slice(1);

      return [
        `### \`${manifest.name}${suffix}\` (${surface.symbols.length})`,
        '',
        ...surface.symbols.map(symbol => `- \`${symbol.name}\` ${symbol.kind}`),
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
      .map(symbol => ({ name: symbol.getName(), kind: PublicSurface.kindOf({ checker, symbol }) }))
      .sort((left, right) => left.name.localeCompare(right.name));

    return { entry: opts.entry, symbols };
  }

  /** Public so `atlas-symbols.ts` records the same vocabulary this snapshot does, never a second one. */
  static kindOf(opts: { checker: TypeScript.TypeChecker; symbol: TypeScript.Symbol }): string {
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
      .map(line => line.replace(/\s+$/, ''))
      .join('\n')
      .trim();
  }
}

export const runSurfaceCommand = (opts: { command?: string }): number => {
  switch (opts.command) {
    case 'gen': {
      writeFileSync(OUTPUT, PublicSurface.render());
      console.log(`wrote ${OUTPUT}`);

      return 0;
    }

    case 'check': {
      if (PublicSurface.check()) {
        console.log('fresh .agents/knowledge/reference/public-surface.md');

        return 0;
      }

      console.error(
        'stale .agents/knowledge/reference/public-surface.md - the public surface changed; ' +
          `${regenerateHintOf({ command: 'surface' })} only if the change is intended`,
      );

      return 1;
    }

    default: {
      console.error('usage: vulcan x atlas surface gen|check');

      return 2;
    }
  }
};
