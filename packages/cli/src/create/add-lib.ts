import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ExitCodes } from '../common/index.ts';
import { LayoutFolder } from '../common/layout-folder.ts';
import { LibraryKinds, PackageKinds } from '../config/index.ts';
import type { IProjectPackage, TLibraryKind, TResolvedConfig } from '../config/index.ts';
import { ProjectScaffold } from '../init/index.ts';
import { AppChecks } from './checks.ts';
import { AddFailure, AppsBlockProblems, CreateConstants, CreateFlags } from './common/index.ts';
import type { IAppsBlock, ILocatedPreset, IPresetSpec } from './common/index.ts';
import { ProjectFile } from './files.ts';
import { LibPreset } from './lib-preset.ts';
import { ManifestJson } from './manifest-json.ts';
import type { TLibPreset } from './lib-preset.ts';
import { ABORTED, WritePlan } from './plan.ts';
import { askInTerminal, ProjectNames, SCOPE_PATTERN } from './names.ts';
import { Preset } from './preset.ts';
import { SubProcess } from './process.ts';
import { AppsBlock, WorkspaceDocs, WorkspaceManifest } from './workspace.ts';

const KNOWLEDGE_DIRECTORY = '.agents/knowledge';
const DIRECTORY_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** A folder from the root, written with slashes, never climbing out or absolute. */
const isProjectFolder = (opts: { folder: string }): boolean =>
  opts.folder
    .replace(/\/+$/, '')
    .split('/')
    .every((segment) => DIRECTORY_SEGMENT.test(segment) && segment !== '..');

const scopeOf = (opts: { name: string }): string =>
  opts.name.startsWith('@') ? opts.name.split('/')[0] : '';

const rootScope = (opts: { manifest: Record<string, unknown> }): string =>
  typeof opts.manifest.name === 'string' ? scopeOf({ name: opts.manifest.name }) : '';

/** Where the new library goes: `--dir`, the layout's shared folder, or the one folder the existing libraries share. */
const folderOf = async (opts: {
  args: string[];
  interactive: boolean;
  lib: string;
  config: TResolvedConfig;
  packages: IProjectPackage[];
}): Promise<{ ok: true; folder: string } | { ok: false; error: string }> => {
  const given = ProjectNames.readFlag({ args: opts.args, flag: CreateFlags.DIR });
  const libFolders = [
    ...new Set(
      opts.packages
        .filter((entry) => entry.kind === PackageKinds.LIB && !entry.retired)
        .map((entry) => dirname(entry.path)),
    ),
  ];
  const shared = LayoutFolder.layoutFoldersOf({ value: opts.config.layout?.shared });
  // One shared folder is the answer; with none the one folder the libraries share is; several are for `--dir` or a menu.
  const fallback =
    shared.length === 1
      ? shared[0]
      : shared.length === 0 && libFolders.length === 1
        ? libFolders[0]
        : undefined;
  let chosen = given;

  if (chosen === undefined) {
    if (opts.interactive) {
      // The folders the project's libraries already live in are picked; a new one is typed.
      const typedFolder = await askInTerminal({
        question: 'Folder',
        previous: fallback,
        choices: [
          ...new Set([...shared, ...(fallback === undefined ? [] : [fallback]), ...libFolders]),
        ],
      });
      const answer = typedFolder?.trim() ?? '';

      chosen = answer === '' ? fallback : answer;
    } else {
      chosen = fallback;
    }
  }

  if (chosen === undefined) {
    return {
      ok: false,
      error: `where should ${opts.lib} go? pass ${CreateFlags.DIR} <folder>${shared.length > 1 ? ` (${LayoutFolder.listedNote({ folders: shared })})` : ''}`,
    };
  }

  const folder = chosen.replace(/^\.\//, '').replace(/\/+$/, '');

  return isProjectFolder({ folder })
    ? { ok: true, folder }
    : { ok: false, error: `${CreateFlags.DIR} '${chosen}' is not a folder inside the project` };
};

/** The package name: `--scope`, what the packages already in the folder agree on, the project's scope, else none. */
const nameOf = (opts: {
  args: string[];
  lib: string;
  folder: string;
  packages: IProjectPackage[];
  manifest: Record<string, unknown>;
}): { ok: true; name: string } | { ok: false; error: string } => {
  const given = ProjectNames.readFlag({ args: opts.args, flag: CreateFlags.SCOPE });

  if (given !== undefined) {
    return SCOPE_PATTERN.test(given)
      ? { ok: true, name: `${given}/${opts.lib}` }
      : { ok: false, error: `${CreateFlags.SCOPE} '${given}' is not a scope like @acme` };
  }

  const siblings = opts.packages.filter(
    (entry) => !entry.retired && dirname(entry.path) === opts.folder,
  );
  const scopes = [...new Set(siblings.map((entry) => scopeOf({ name: entry.name })))].sort();

  if (scopes.length > 1) {
    return {
      ok: false,
      error: `the packages in ${opts.folder} use more than one scope (${scopes.map((scope) => scope || 'unscoped').join(', ')}) - pass ${CreateFlags.SCOPE} <@scope>`,
    };
  }

  const scope = scopes.length === 1 ? scopes[0] : rootScope({ manifest: opts.manifest });

  return { ok: true, name: scope === '' ? opts.lib : `${scope}/${opts.lib}` };
};

export class LibraryScaffold {
  /** The sibling-name rule needs the entries the config holds, not only the folder's directories. */
  static async add(opts: {
    cwd: string;
    args: string[];
    interactive: boolean;
    presetValue: string;
    spec: IPresetSpec;
    located: ILocatedPreset;
    config: TResolvedConfig;
    configFile: string;
    configPath: string;
    manifest: Record<string, unknown>;
    packages: IProjectPackage[];
    libName: string;
    /** Which preset kind makes the package: `lib` (the default) or the side-neutral `shared`. */
    kind?: TLibraryKind;
    recorded: (opts: { block: IAppsBlock }) => IAppsBlock;
  }): Promise<number> {
    const { cwd, config, located, libName } = opts;
    const kind = opts.kind ?? LibraryKinds.LIB;

    if (!CreateConstants.NAME_PATTERN.test(libName)) {
      return AddFailure.fail({
        message: `'${libName}' is not a name - lowercase letters, digits and -, starting with a letter or digit`,
      });
    }

    const read = LibPreset.read({ located, kind });

    if (!read.ok) {
      return AddFailure.fail({ message: read.error });
    }

    const lib: TLibPreset = read.lib;
    const placed = await folderOf({
      args: opts.args,
      interactive: opts.interactive,
      lib: libName,
      config,
      packages: opts.packages,
    });

    if (!placed.ok) {
      return AddFailure.fail({ message: placed.error });
    }

    const { folder } = placed;
    const named = nameOf({
      args: opts.args,
      lib: libName,
      folder,
      packages: opts.packages,
      manifest: opts.manifest,
    });

    if (!named.ok) {
      return AddFailure.fail({ message: named.error });
    }

    const path = `${folder}/${libName}`;

    if (
      existsSync(join(cwd, path)) ||
      opts.packages.some((entry) => entry.dir === libName || entry.name === named.name)
    ) {
      return AddFailure.fail({ message: `${path} already exists` });
    }

    const source = readFileSync(opts.configFile, 'utf8');
    const parsed = AppsBlock.parse({ source });

    if (!parsed.ok) {
      return AddFailure.fail({
        message:
          parsed.reason === AppsBlockProblems.MISSING
            ? `the vulcan:apps block is gone from ${opts.configPath} - add the package by hand: { dir: '${libName}', name: '${named.name}', path: '${path}', kind: 'lib' }`
            : `the vulcan:apps block in ${opts.configPath} is not the JSON vulcan wrote - add the package by hand: { dir: '${libName}', name: '${named.name}', path: '${path}', kind: 'lib' }`,
      });
    }

    const sharedBefore = parsed.block.layout.shared;
    const grown = LayoutFolder.withLayoutFolder({ value: sharedBefore, folder });
    // A valid folder the layout does not list yet is added to layout.shared, unless it would nest with another folder.
    const isListed = LayoutFolder.layoutFoldersOf({ value: sharedBefore }).includes(folder);
    const notRecorded = isListed
      ? undefined
      : (LayoutFolder.layoutFolderProblem({ folder }) ??
        LayoutFolder.layoutOverlapProblems({
          layout: { ...parsed.block.layout, shared: grown },
        }).join('; '));
    const isNewFolder = !isListed && notRecorded === '';
    const block = opts.recorded({
      block: {
        ...parsed.block,
        layout: isNewFolder ? { ...parsed.block.layout, shared: grown } : parsed.block.layout,
        packages: [
          ...parsed.block.packages,
          {
            dir: libName,
            name: named.name,
            path,
            kind: PackageKinds.LIB,
            ...(kind === LibraryKinds.SHARED ? { presetKind: LibraryKinds.SHARED } : {}),
          },
        ],
      },
    });
    const replaced = AppsBlock.replace({ source, block });
    const nextConfig =
      replaced === undefined || replaced.includes('apps.presets')
        ? replaced
        : replaced.replace(
            '  packages: apps.packages,\n',
            '  packages: apps.packages,\n  presets: apps.presets,\n',
          );

    if (nextConfig === undefined) {
      return AddFailure.fail({
        message: `the vulcan:apps block of ${opts.configPath} cannot be rewritten`,
      });
    }

    const project =
      config.name ?? (typeof opts.manifest.name === 'string' ? opts.manifest.name : libName);
    const warning = WorkspaceDocs.filePresetWarning({
      spec: opts.spec,
      packageName: located.packageName,
    });

    if (warning !== undefined) {
      process.stderr.write(`${warning}\n`);
    }

    // The folder is used all the same; the layout does not list it, so `guard-package` does not cover it.
    if (notRecorded !== undefined && notRecorded !== '') {
      process.stderr.write(
        `note: '${folder}' is not added to layout.shared (${notRecorded}); guard-package does not cover it\n`,
      );
    }

    const rows: [string, string][] = [
      [kind === LibraryKinds.SHARED ? 'shared package' : 'library', path],
    ];

    if (isNewFolder) {
      rows.push([
        'layout',
        `adds '${folder}' to layout.shared (now ${LayoutFolder.describe({ folders: LayoutFolder.layoutFoldersOf({ value: grown }) })})`,
      ]);
    }

    rows.push(
      ['package', named.name],
      ['preset', `${located.packageName} ${located.packageVersion}`],
    );

    const confirmed = await WritePlan.confirm({
      title: `Add ${libName}`,
      lines: WritePlan.planLines({ rows }),
    });

    if (!confirmed) {
      return AddFailure.fail({ message: ABORTED });
    }

    const written = Preset.copyFiles({
      located,
      files: lib.files,
      target: join(cwd, path),
      tokens: {
        project,
        [kind === LibraryKinds.SHARED ? 'shared' : 'lib']: libName,
        package: named.name,
      },
    });

    for (const file of written) {
      process.stderr.write(`  created  ${path}/${file}\n`);
    }

    ProjectFile.write({
      root: cwd,
      path: `${path}/package.json`,
      content: WorkspaceManifest.renderLib({ name: named.name, lib }),
    });

    const nextManifest = WorkspaceManifest.planRoot({
      manifest: opts.manifest,
      globs: ProjectScaffold.readWorkspaceGlobs({ root: cwd }),
      folder,
      additions: { ...lib.dependencies, ...lib.devDependencies, ...lib.peerDependencies },
    });

    ProjectFile.write({
      root: cwd,
      path: 'package.json',
      content: ManifestJson.render({ value: nextManifest }),
    });
    ProjectFile.write({ root: cwd, path: opts.configPath, content: nextConfig });
    ProjectFile.write({
      root: cwd,
      path: `${KNOWLEDGE_DIRECTORY}/packages/${libName}.md`,
      content: WorkspaceDocs.renderLibConcept({
        name: libName,
        path,
        summary: lib.summary,
        presetPackage: located.packageName,
        kind,
      }),
    });

    const indexPath = join(cwd, KNOWLEDGE_DIRECTORY, 'index.md');

    ProjectFile.write({
      root: cwd,
      path: `${KNOWLEDGE_DIRECTORY}/index.md`,
      content: existsSync(indexPath)
        ? AppsBlock.addBullet({
            source: readFileSync(indexPath, 'utf8'),
            app: { name: libName, summary: lib.summary },
          })
        : WorkspaceDocs.renderKnowledgeIndex({
            project,
            apps: [{ name: libName, summary: lib.summary }],
          }),
    });

    for (const step of [
      () => SubProcess.runBun({ cwd, args: ['install'], label: 'bun install' }),
      () =>
        SubProcess.runBun({
          cwd,
          args: [join(cwd, 'node_modules', '.bin', 'vulcan'), 'sync'],
          label: 'vulcan sync',
        }),
      () => AppChecks.run({ root: cwd, appDirectory: join(cwd, path), checks: lib.checks }),
    ]) {
      const code = await step();

      if (code !== ExitCodes.OK) {
        return code;
      }
    }

    process.stderr.write(`Done. ${path} is added.\n`);

    return ExitCodes.OK;
  }
}
