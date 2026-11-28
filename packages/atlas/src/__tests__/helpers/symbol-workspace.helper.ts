import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import ts from 'typescript';

/** The kinds of export a package of the workspace holds, each spelled so that its declaration is on a line of its own. */
const KINDS = [
  (name: string) => `export function ${name}(value: string): string {\n  return value;\n}`,
  (name: string) => `export class ${name} {\n  run(): void {}\n}`,
  (name: string) => `export interface ${name} {\n  id: number;\n}`,
  (name: string) => `export type ${name} = { id: number };`,
  (name: string) => `export const ${name} = { id: 1 };`,
  (name: string) => `export enum ${name} {\n  One = 1,\n}`,
];

/** Exports of each package, enough to sample from. */
const PER_PACKAGE = 24;

/**
 * `core` also re-exports under other names: `BaseEntity` is spelled only in the entry, never where its class is declared;
 * `IConfigs` is spelled in the declaring file too.
 */
const ALIASES: Record<string, Record<string, string>> = {
  core: {
    'entity.ts': 'export class BaseRelationalEntity {\n  id = 0;\n}\n',
    'configs.ts':
      '/** Once named IConfigs. */\nexport interface IKernelConfigs {\n  name: string;\n}\n',
    'aliases.ts':
      "export { BaseRelationalEntity as BaseEntity } from './entity';\nexport type { IKernelConfigs as IConfigs } from './configs';\n",
  },
};

const ALIAS_EXPORTS: Record<string, string[]> = {
  core: ['./entity', './configs', './aliases'],
};

const write = (opts: { file: string; text: string }): void => {
  mkdirSync(dirname(opts.file), { recursive: true });
  writeFileSync(opts.file, opts.text);
};

/** One package: its sources, and the declarations and declaration maps the compiler emits from them. */
const writePackage = (opts: { root: string; dir: string }): void => {
  const folder = join(opts.root, 'packages', opts.dir);
  const modules = Array.from({ length: PER_PACKAGE }, (_, index) => ({
    file: `item-${index}.ts`,
    // A comment of a varying length, so that a line number is never right by chance.
    text: `${'// filler\n'.repeat(index % 5)}${KINDS[index % KINDS.length]?.(`${opts.dir}Item${index}`) ?? ''}\n`,
  }));
  const sources: Record<string, string> = {
    ...Object.fromEntries(modules.map((module) => [module.file, module.text])),
    ...ALIASES[opts.dir],
  };
  const exported = [
    ...modules.map((module) => `./${module.file.replace(/\.ts$/, '')}`),
    ...(ALIAS_EXPORTS[opts.dir] ?? []),
  ];

  sources['index.ts'] = exported.map((path) => `export * from '${path}';\n`).join('');

  for (const [file, text] of Object.entries(sources)) {
    write({ file: join(folder, 'src', file), text });
  }

  write({
    file: join(folder, 'package.json'),
    text: JSON.stringify({
      name: `@fixture/${opts.dir}`,
      version: '1.0.0',
      exports: { '.': { types: './dist/cjs/index.d.ts' } },
    }),
  });

  ts.createProgram(
    Object.keys(sources).map((file) => join(folder, 'src', file)),
    {
      declaration: true,
      declarationMap: true,
      emitDeclarationOnly: true,
      rootDir: join(folder, 'src'),
      outDir: join(folder, 'dist', 'cjs'),
      strict: true,
      types: [],
    },
  ).emit();
};

/** A built workspace of three packages in a temp folder, the same on every machine. */
export class SymbolWorkspace {
  static readonly PACKAGES = ['core', 'helpers', 'kernel'];

  static create(): { root: string; remove: () => void } {
    const root = mkdtempSync(join(tmpdir(), 'atlas-symbol-workspace-'));

    for (const dir of SymbolWorkspace.PACKAGES) {
      writePackage({ root, dir });
    }

    return { root, remove: () => rmSync(root, { recursive: true, force: true }) };
  }
}
