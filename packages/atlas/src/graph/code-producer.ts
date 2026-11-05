import { existsSync, readFileSync, statSync } from 'node:fs';
import { posix, relative, resolve, sep } from 'node:path';
import { PackageEntries } from '@/common/package-entries';
import type { IAtlasPackage, IAtlasProject } from '@/common/project-config';
import {
  GraphConstants,
  GraphEdgeKinds,
  GraphIdPrefixes,
  GraphNodeKinds,
} from './common/constants';
import type { IGraphEdge, IGraphNode, IGraphPart, IGraphProducer } from './common/types';
import { GraphOrder } from './common/order';
import { ImportReader } from './import-reader';
import { ImportResolver } from './import-resolver';

/** The code graph: packages, the entries of their `exports`, the tracked TypeScript files, and how they import each other. */
export class CodeProducer implements IGraphProducer<{
  root: string;
  project: IAtlasProject;
  /** The tracked files of the scope, repository paths. */
  files: string[];
}> {
  readonly kinds = [GraphNodeKinds.PACKAGE, GraphNodeKinds.ENTRY, GraphNodeKinds.FILE];

  produce(opts: { root: string; project: IAtlasProject; files: string[] }): IGraphPart {
    const packages = opts.project.packages.filter((item) => !item.retired);
    const config = opts.project.graph;
    const globs = config.exclude.map((pattern) => new Bun.Glob(pattern));
    const files = opts.files
      .filter((file) => GraphConstants.SOURCE_PATTERN.test(file))
      .filter((file) => CodeProducer.ownerOf({ file, packages }) !== undefined)
      .filter((file) => !globs.some((glob) => glob.match(file)))
      .filter((file) => CodeProducer.isReadable({ path: resolve(opts.root, file) }))
      .sort(GraphOrder.byText);
    const fileSet = new Set(files);
    const nodes = new Map<string, IGraphNode>();
    const edges = new Map<string, IGraphEdge>();
    const addEdge = (edge: IGraphEdge): void => {
      edges.set(`${edge.kind}\0${edge.from}\0${edge.to}`, edge);
    };
    /** The tracked source file each entry specifier leads to, when one does. */
    const entryFiles = new Map<string, string | undefined>();

    for (const item of packages) {
      const id = `${GraphIdPrefixes.PACKAGE}${item.name}`;

      nodes.set(id, { id, kind: GraphNodeKinds.PACKAGE, name: item.name, path: item.path });

      for (const entry of CodeProducer.entriesOf({ root: opts.root, item, files: fileSet })) {
        const entryId = `${GraphIdPrefixes.ENTRY}${entry.specifier}`;

        entryFiles.set(entry.specifier, entry.file);
        nodes.set(entryId, {
          id: entryId,
          kind: GraphNodeKinds.ENTRY,
          name: entry.specifier,
          package: item.name,
        });
        addEdge({ from: id, to: entryId, kind: GraphEdgeKinds.CONTAINS });

        if (entry.file !== undefined) {
          addEdge({
            from: entryId,
            to: `${GraphIdPrefixes.FILE}${entry.file}`,
            kind: GraphEdgeKinds.CONTAINS,
          });
        }
      }

      for (const dependency of CodeProducer.dependenciesOf({ root: opts.root, item })) {
        if (dependency !== item.name && packages.some((other) => other.name === dependency)) {
          addEdge({
            from: id,
            to: `${GraphIdPrefixes.PACKAGE}${dependency}`,
            kind: GraphEdgeKinds.DEPENDS,
          });
        }
      }
    }

    const entrySpecifiers = new Set(entryFiles.keys());

    for (const file of files) {
      const owner = CodeProducer.ownerOf({ file, packages });
      const id = `${GraphIdPrefixes.FILE}${file}`;
      const external = new Set<string>();
      const isTest = GraphConstants.TEST_PATTERN.test(file);
      const text = readFileSync(resolve(opts.root, file), 'utf8');

      for (const specifier of ImportReader.specifiersOf({ text })) {
        const target = ImportResolver.resolve({
          from: file,
          specifier,
          packagePath: owner?.path ?? '',
          files: fileSet,
          aliases: config.aliases,
          entries: entrySpecifiers,
        });

        if (target.kind === 'external') {
          external.add(target.specifier);
        } else if (target.kind === 'entry') {
          const source = entryFiles.get(target.specifier);

          addEdge({
            from: id,
            to: `${GraphIdPrefixes.ENTRY}${target.specifier}`,
            kind: GraphEdgeKinds.IMPORTS,
          });

          if (isTest && source !== undefined) {
            addEdge({
              from: `${GraphIdPrefixes.FILE}${source}`,
              to: id,
              kind: GraphEdgeKinds.TESTED_BY,
            });
          }
        } else {
          const to = `${GraphIdPrefixes.FILE}${target.path}`;

          addEdge({ from: id, to, kind: GraphEdgeKinds.IMPORTS });

          if (isTest && !GraphConstants.TEST_PATTERN.test(target.path)) {
            addEdge({ from: to, to: id, kind: GraphEdgeKinds.TESTED_BY });
          }
        }
      }

      nodes.set(id, {
        id,
        kind: GraphNodeKinds.FILE,
        name: posix.basename(file),
        path: file,
        ...(owner === undefined ? {} : { package: owner.name }),
        ...(external.size === 0 ? {} : { external: [...external].sort(GraphOrder.byText) }),
      });
    }

    return {
      nodes: [...nodes.values()].sort((a, b) => GraphOrder.byText(a.id, b.id)),
      edges: [...edges.values()].sort((a, b) => GraphOrder.byEdge(a, b)),
    };
  }

  /** A regular file the build can read: a tracked file deleted from the working tree, or a link to nothing, is skipped. */
  private static isReadable(opts: { path: string }): boolean {
    try {
      return statSync(opts.path).isFile();
    } catch {
      return false;
    }
  }

  /** The package of a repository path: the one with the longest path that holds it. */
  private static ownerOf(opts: {
    file: string;
    packages: IAtlasPackage[];
  }): IAtlasPackage | undefined {
    return opts.packages
      .filter((item) => opts.file.startsWith(`${item.path}/`))
      .sort((a, b) => b.path.length - a.path.length)[0];
  }

  private static specifierOf(opts: { name: string; subpath: string }): string {
    return opts.subpath === '.' ? opts.name : `${opts.name}/${opts.subpath.replace(/^\.\//, '')}`;
  }

  /** The `exports` entries of a package and the tracked source file each one leads to, when there is one. */
  private static entriesOf(opts: {
    root: string;
    item: IAtlasPackage;
    files: ReadonlySet<string>;
  }): { specifier: string; file?: string }[] {
    const directory = resolve(opts.root, opts.item.path);

    if (!existsSync(resolve(directory, 'package.json'))) {
      return [];
    }

    const { entries } = PackageEntries.readDirectory({
      directory,
      name: opts.item.name,
      withSource: true,
    });

    return entries
      .map((entry) => ({
        specifier: CodeProducer.specifierOf({ name: opts.item.name, subpath: entry.subpath }),
        file: CodeProducer.sourceOf({
          path: relative(resolve(opts.root), entry.file).split(sep).join('/'),
          packagePath: opts.item.path,
          files: opts.files,
        }),
      }))
      .sort((a, b) => GraphOrder.byText(a.specifier, b.specifier));
  }

  /**
   * The tracked source file an entry target stands for: the target itself when it is tracked (source, or a hand-written
   * declaration), else, for a built declaration (`dist/esm/index.d.ts`), the file of `src/` it comes from. Undefined when none is tracked.
   */
  private static sourceOf(opts: {
    path: string;
    packagePath: string;
    files: ReadonlySet<string>;
  }): string | undefined {
    if (opts.files.has(opts.path)) {
      return opts.path;
    }

    if (!GraphConstants.DECLARATION_ENDING.test(opts.path)) {
      return undefined;
    }

    const inside = opts.path
      .slice(opts.packagePath.length + 1)
      .replace(GraphConstants.DECLARATION_ENDING, '');
    const folder = GraphConstants.BUILD_FOLDERS.find((item) => inside.startsWith(item));
    const rest = folder === undefined ? inside : inside.slice(folder.length);

    for (const subfolder of GraphConstants.BUILD_SUBFOLDERS) {
      const stem = rest.startsWith(subfolder) ? rest.slice(subfolder.length) : rest;
      const found = ImportResolver.fileOf({
        base: posix.join(opts.packagePath, 'src', stem),
        files: opts.files,
      });

      if (found !== undefined) {
        return found;
      }
    }

    return undefined;
  }

  /** The names in `dependencies` and `peerDependencies` of a package. */
  private static dependenciesOf(opts: { root: string; item: IAtlasPackage }): string[] {
    const file = resolve(opts.root, opts.item.path, 'package.json');

    if (!existsSync(file)) {
      return [];
    }

    const manifest: { dependencies?: object; peerDependencies?: object } = JSON.parse(
      readFileSync(file, 'utf8'),
    );

    return [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ].sort(GraphOrder.byText);
  }
}
