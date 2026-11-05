import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { PackageEntries } from '@/common/package-entries';
import type { IAtlasProject } from '@/common/project-config';
import { CodeProducer } from './code-producer';
import { GraphConstants, GraphFiles } from './common/constants';
import { GraphOrder } from './common/order';
import type { IFingerprints } from './common/types';
import { GraphHash } from './hash';
import { ImportReader } from './import-reader';
import { SurfaceReader } from './surface-reader';

/** What each file the graph reads looked like at the last build, so the next build can tell what changed. */
export class Fingerprints {
  static readonly SCHEMA_VERSION = 1;

  /**
   * The fingerprints of the working tree: each source file (its bytes, its skeleton, its imports), each `package.json`
   * (its bytes), each package's built declarations (the size and time of the `.d.ts` files below its entries), and the
   * settings that shape the graph (the packages and the `graph` block of the config).
   */
  static of(opts: { root: string; project: IAtlasProject; files: string[] }): IFingerprints {
    const sources = CodeProducer.sourceFilesOf(opts);
    const packages = opts.project.packages.filter((item) => !item.retired);
    const declarations = Fingerprints.declarationsOfPackages(opts);
    const files: IFingerprints['files'] = {};

    for (const file of sources) {
      const bytes = readFileSync(resolve(opts.root, file));
      const text = bytes.toString('utf8');

      const owner = CodeProducer.packageOf({ file, project: opts.project }) ?? '';
      const content = GraphHash.of({ data: bytes });

      files[file] = {
        package: owner,
        content,
        // A package with no built declarations has its symbols read from its source, which holds their line, their TSDoc and
        // their bodies: any change to such a file is structural.
        surface:
          declarations[owner] === ''
            ? content
            : GraphHash.of({ data: SurfaceReader.of({ text, path: file }) }),
        imports: GraphHash.of({ data: ImportReader.specifiersOf({ text }).join('\n') }),
      };
    }

    for (const item of packages) {
      const manifest = posix.join(item.path, 'package.json');
      const path = resolve(opts.root, manifest);

      if (existsSync(path)) {
        files[manifest] = {
          package: item.name,
          content: GraphHash.of({ data: readFileSync(path) }),
          manifest: true,
        };
      }
    }

    return {
      schemaVersion: Fingerprints.SCHEMA_VERSION,
      files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => GraphOrder.byText(a, b))),
      declarations,
      inputs: Fingerprints.inputsOf({ project: opts.project }),
    };
  }

  /** The digest of the built declarations of each live package, by npm name. */
  static declarationsOfPackages(opts: {
    root: string;
    project: IAtlasProject;
  }): Record<string, string> {
    return Object.fromEntries(
      opts.project.packages
        .filter((item) => !item.retired)
        .map((item) => [
          item.name,
          Fingerprints.declarationsOf({ root: opts.root, path: item.path }),
        ]),
    );
  }

  /** A hash of what shapes the graph besides the files: the format, the packages and the `graph` block of the config. */
  static inputsOf(opts: { project: IAtlasProject }): string {
    return GraphHash.of({
      data: JSON.stringify({
        format: [GraphConstants.SCHEMA_VERSION, GraphConstants.PRODUCER_VERSION],
        packages: opts.project.packages
          .filter((item) => !item.retired)
          .map((item) => [item.name, item.path])
          .sort(),
        graph: opts.project.graph,
      }),
    });
  }

  /** Only the bytes of each file the graph reads: what `status` compares, with no parsing. */
  static contentsOf(opts: {
    root: string;
    project: IAtlasProject;
    files: string[];
  }): Record<string, string> {
    const manifests = opts.project.packages
      .filter((item) => !item.retired)
      .map((item) => posix.join(item.path, 'package.json'))
      .filter((path) => existsSync(resolve(opts.root, path)));

    return Object.fromEntries(
      [...CodeProducer.sourceFilesOf(opts), ...manifests]
        .sort(GraphOrder.byText)
        .map((path) => [path, GraphHash.of({ data: readFileSync(resolve(opts.root, path)) })]),
    );
  }

  /**
   * A digest of the built declaration files a package's entries lead to: path, size and modification time of every
   * `.d.ts` below the folder each declaration entry sits in (`dist/`). A package that builds none gives an empty digest.
   */
  private static declarationsOf(opts: { root: string; path: string }): string {
    const directory = resolve(opts.root, opts.path);

    if (!existsSync(join(directory, 'package.json'))) {
      return '';
    }

    const lines: string[] = [];
    const folders = new Set<string>();

    for (const entry of PackageEntries.readDirectory({ directory, withSource: false }).entries) {
      const parts = relative(directory, entry.file).split(sep);

      if (parts.length === 1) {
        // An entry that sits at the root of the package is a file, not a folder to walk.
        Fingerprints.stat({ path: entry.file, base: directory, lines });
      } else {
        folders.add(parts[0] ?? '');
      }
    }

    for (const folder of folders) {
      Fingerprints.walk({ directory: join(directory, folder), base: directory, lines });
    }

    return lines.length === 0
      ? ''
      : GraphHash.of({ data: lines.sort(GraphOrder.byText).join('\n') });
  }

  private static stat(opts: { path: string; base: string; lines: string[] }): void {
    if (!existsSync(opts.path)) {
      return;
    }

    const stat = statSync(opts.path);

    opts.lines.push(`${relative(opts.base, opts.path)}:${stat.size}:${Math.floor(stat.mtimeMs)}`);
  }

  private static walk(opts: { directory: string; base: string; lines: string[] }): void {
    if (!existsSync(opts.directory) || !statSync(opts.directory).isDirectory()) {
      return;
    }

    for (const entry of readdirSync(opts.directory, { withFileTypes: true })) {
      const path = join(opts.directory, entry.name);

      if (entry.isDirectory()) {
        Fingerprints.walk({ directory: path, base: opts.base, lines: opts.lines });
      } else if (GraphConstants.DECLARATION_ENDING.test(entry.name)) {
        Fingerprints.stat({ path, base: opts.base, lines: opts.lines });
      }
    }
  }

  /** One line for each file, so a diff of two states reads as a list. */
  static render(opts: { fingerprints: IFingerprints }): string {
    const { fingerprints } = opts;
    const files = Object.entries(fingerprints.files).map(
      ([path, value]) => `${JSON.stringify(path)}:${JSON.stringify(value)}`,
    );

    return `{"schemaVersion":${fingerprints.schemaVersion},"inputs":${JSON.stringify(fingerprints.inputs)},"declarations":${JSON.stringify(fingerprints.declarations)},\n"files":{\n${files.join(',\n')}\n}}\n`;
  }

  /** The fingerprints of the last build; undefined when there are none, or they are of another schema or unreadable. */
  static read(opts: { root: string }): IFingerprints | undefined {
    const file = join(opts.root, GraphFiles.DIRECTORY, GraphFiles.FINGERPRINTS);

    if (!existsSync(file)) {
      return undefined;
    }

    try {
      const parsed: IFingerprints = JSON.parse(readFileSync(file, 'utf8'));

      return parsed.schemaVersion === Fingerprints.SCHEMA_VERSION ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  /** Written whole to a temporary name, then renamed. */
  static write(opts: { root: string; fingerprints: IFingerprints }): void {
    const file = join(opts.root, GraphFiles.DIRECTORY, GraphFiles.FINGERPRINTS);
    const temporary = `${file}.${process.pid}.tmp`;

    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(temporary, Fingerprints.render({ fingerprints: opts.fingerprints }));
    renameSync(temporary, file);
  }
}
