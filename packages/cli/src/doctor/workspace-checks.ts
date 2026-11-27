import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { ProjectLayout } from '../common/index.ts';
import { LayoutKeys, LayoutFolder } from '../common/layout-folder.ts';
import { ProjectScaffold } from '../init/index.ts';
import { ProjectPackages, WorkspacePackages, pathKeyOf } from '../config/index.ts';
import { DoctorChecks, DoctorConstants } from './common/index.ts';
import type { ICheckContext, IViolation } from './common/index.ts';
import { DoctorCheckUtility } from './utilities/doctor-check.utility.ts';

const hasStylePackage = (opts: { directory: string }): boolean => {
  const file = join(opts.directory, 'package.json');

  if (!existsSync(file)) {
    return false;
  }

  const manifest: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  } = JSON.parse(readFileSync(file, 'utf8'));

  return ProjectLayout.STYLE_PACKAGE in { ...manifest.dependencies, ...manifest.devDependencies };
};

const readScriptNames = (opts: { file: string }): string[] | undefined => {
  if (!existsSync(opts.file)) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(readFileSync(opts.file, 'utf8'));
    const scripts =
      typeof parsed === 'object' && parsed !== null && 'scripts' in parsed ? parsed.scripts : {};

    return typeof scripts === 'object' && scripts !== null ? Object.keys(scripts) : [];
  } catch (error) {
    console.error(
      `[readScriptNames] ${opts.file} | ${error instanceof Error ? error.message : String(error)}`,
    );

    return undefined;
  }
};

const FMT_SECTION_ADVICE =
  'add a [fmt] section (printWidth = 100, singleQuote = true, arrowParens = "always", flavor = "oxfmt"): without it bun fmt formats with Bun\'s defaults, not the shared style';

const FMT_FLAVOR_ADVICE =
  'without it bun fmt uses its default style when oxfmt is not a dependency, and the output changes';

const OXFMT_LOADED_ADVICE =
  'bun fmt loads it and it overrides the [fmt] section of bunfig.toml - delete it, or move its settings to [fmt]';

/** The folders that can hold a package.json and an oxfmt config: the root, `packages/*` and every configured package. */
const formatOwners = (opts: ICheckContext): string[] => [
  ...new Set([
    '.',
    ...DoctorCheckUtility.listDirectories({ directory: join(opts.root, 'packages') }).map((name) =>
      join('packages', name),
    ),
    ...ProjectPackages.resolve({ config: opts.config })
      .filter((entry) => !entry.retired)
      .map((entry) => relative(opts.root, join(opts.root, entry.path)) || '.'),
  ]),
];

/** The checks of the packages of a project: the shared style, the scaffold, the layout folders, the workspace members and the format setup. */
export class WorkspaceChecks {
  /**
   * D9: the shared coding style - every lint config builds on it, and the package whose `.configs/`
   * holds the config declares it, or the root does. A project with no lint config declares it at the
   * root. Owners are `packages/*` and every configured package's `path`, such as `backends/kit`.
   */
  static checkStyle(opts: ICheckContext): IViolation[] {
    const violations: IViolation[] = [];
    const owners = [
      ...new Set([
        '.',
        ...DoctorCheckUtility.listDirectories({ directory: join(opts.root, 'packages') }).map(
          (name) => join('packages', name),
        ),
        ...ProjectPackages.resolve({ config: opts.config }).map(
          (entry) => relative(opts.root, join(opts.root, entry.path)) || '.',
        ),
      ]),
    ];
    const isRootDeclared = hasStylePackage({ directory: opts.root });
    let lintConfigs = 0;

    for (const owner of owners) {
      const configs = join(owner, '.configs');
      const directory = join(configs, DoctorConstants.LINT_CONFIG_FOLDER);
      const found = existsSync(join(opts.root, directory))
        ? readdirSync(join(opts.root, directory))
            .filter((file) => DoctorConstants.LINT_CONFIG_FILE.test(file))
            .map((file) => join(directory, file))
        : [];

      lintConfigs += found.length;

      if (
        found.length > 0 &&
        !isRootDeclared &&
        !hasStylePackage({ directory: join(opts.root, owner) })
      ) {
        violations.push(
          DoctorCheckUtility.createViolation({
            check: DoctorChecks.STYLE,
            file: join(owner, 'package.json'),
            message: `add ${ProjectLayout.STYLE_PACKAGE} as a devDependency - here, or at the root`,
          }),
        );
      }

      for (const file of found) {
        if (
          !DoctorCheckUtility.readText({ file: join(opts.root, file) }).includes(
            ProjectLayout.STYLE_PACKAGE,
          )
        ) {
          violations.push(
            DoctorCheckUtility.createViolation({
              check: DoctorChecks.STYLE,
              file,
              message: `build on the shared style: import from ${ProjectLayout.STYLE_PACKAGE}`,
            }),
          );
        }
      }
    }

    if (lintConfigs === 0 && !isRootDeclared) {
      violations.push(
        DoctorCheckUtility.createViolation({
          check: DoctorChecks.STYLE,
          file: 'package.json',
          message: `add ${ProjectLayout.STYLE_PACKAGE} as a devDependency`,
        }),
      );
    }

    return violations;
  }

  /**
   * The scaffold is filled in: `init` writes a config and a knowledge index to be edited, and a
   * project that never did would otherwise pass. A workspaces project declares its packages, and the
   * knowledge index drops the scaffold marker once it describes the project.
   */
  static checkScaffold(opts: ICheckContext): IViolation[] {
    const violations: IViolation[] = [];

    if (
      ProjectScaffold.declaresWorkspaces({ root: opts.root }) &&
      ProjectPackages.resolve({ config: opts.config }).length === 0
    ) {
      violations.push(
        DoctorCheckUtility.createViolation({
          check: DoctorChecks.SCAFFOLD,
          file: opts.configFile,
          message:
            'package.json declares workspaces but the config lists no packages and none could be derived - give each workspace member a package.json with a name, or add packages: [{ dir, name, path }] in release order',
        }),
      );
    }

    const index = join(opts.config.knowledge.bundle, 'index.md');

    if (
      DoctorCheckUtility.readText({ file: join(opts.root, index) }).includes(
        ProjectLayout.SCAFFOLD_MARKER,
      )
    ) {
      violations.push(
        DoctorCheckUtility.createViolation({
          check: DoctorChecks.SCAFFOLD,
          file: index,
          message: `still the scaffold - describe the project, then delete the ${ProjectLayout.SCAFFOLD_MARKER} line`,
        }),
      );
    }

    return violations;
  }

  /** Apps sit in the folders the user named, and every named folder is a workspace. */
  static checkApps(opts: ICheckContext): IViolation[] {
    const layout = opts.config.layout;

    if (layout === undefined) {
      return [];
    }

    const globs = ProjectScaffold.readWorkspaceGlobs({ root: opts.root });
    const folders = LayoutKeys.ALL.flatMap((key) =>
      LayoutFolder.layoutFoldersOf({ value: layout[key] }).map((folder) => ({ side: key, folder })),
    );
    // A folder under `other` is deliberately not managed: it need not be a workspace, only a package in it is allowed.
    const violations = folders
      .filter(
        ({ side, folder }) =>
          side !== LayoutKeys.OTHER && !ProjectScaffold.coversFolder({ globs, folder }),
      )
      .map(({ side, folder }) =>
        DoctorCheckUtility.createViolation({
          check: DoctorChecks.APPS,
          file: 'package.json',
          message: `layout.${side} '${folder}' is not in package.json workspaces - add '${folder}/*'`,
        }),
      );
    const names = folders.map(({ folder }) => folder);
    // A package may be an `other` folder itself (a docs site at `docs`); a side folder only holds packages.
    const otherNames = folders
      .filter(({ side }) => side === LayoutKeys.OTHER)
      .map(({ folder }) => folder);

    for (const entry of ProjectPackages.resolve({ config: opts.config }).filter(
      (item) => !item.retired,
    )) {
      if (entry.type === 'lib') {
        const parent = dirname(entry.path);

        // A library lives where the project keeps libraries; it only has to be a workspace.
        if (!ProjectScaffold.coversFolder({ globs, folder: parent })) {
          violations.push(
            DoctorCheckUtility.createViolation({
              check: DoctorChecks.APPS,
              file: opts.configFile,
              message: `package ${entry.dir} lives at ${entry.path}, which no workspace glob covers - add '${parent}/*' to workspaces`,
            }),
          );
        }

        continue;
      }

      if (
        !names.some((folder) => entry.path.startsWith(`${folder}/`)) &&
        !otherNames.includes(entry.path)
      ) {
        violations.push(
          DoctorCheckUtility.createViolation({
            check: DoctorChecks.APPS,
            file: opts.configFile,
            message: `package ${entry.dir} lives at ${entry.path}, outside every layout folder (${names.join(', ')})`,
          }),
        );
      }
    }

    return violations;
  }

  /**
   * A workspace member of the root `package.json` that the config's `packages` list does not name: a package every table
   * keyed by `packages` (release tags, versions, the atlas) then misses. A member whose `package.json` is `"private": true` is never published, so it is not
   * expected in the list. A list that is derived from the workspaces
   * has none of those; the other warning is for the members that cannot be a package (a folder that is not a valid key, a
   * member with no valid name), each named with its reason, derived list or written. Retired entries count as named. Warnings.
   */
  static checkWorkspacePackages(opts: ICheckContext): IViolation[] {
    const named = new Set(
      ProjectPackages.resolve({ config: opts.config }).map((entry) =>
        pathKeyOf({ path: entry.path }),
      ),
    );
    const derived = WorkspacePackages.derive({ root: opts.root });
    const missing = derived.packages.filter(
      (entry) =>
        !named.has(pathKeyOf({ path: entry.path })) &&
        !WorkspacePackages.isPrivate({ root: opts.root, folder: entry.path }),
    );
    const message = [
      missing.length === 0
        ? undefined
        : `${missing.length} workspace member(s) of the root package.json are not in packages: ${missing.map((entry) => `${entry.name} (${entry.path})`).join(', ')}. Add them, or delete \`packages\` so it is derived from the workspaces`,
      derived.skipped.length === 0
        ? undefined
        : `${derived.skipped.length} workspace member(s) cannot be a package and are left out: ${derived.skipped.map((entry) => `${entry.path} (${entry.reason})`).join('; ')}. Rename the folder or the package, or write \`packages\` with the dir you want`,
    ];

    return message.flatMap((text) =>
      text === undefined
        ? []
        : [
            DoctorCheckUtility.createViolation({
              check: DoctorChecks.WORKSPACE_PACKAGES,
              file: opts.configFile,
              message: text,
            }),
          ],
    );
  }

  /**
   * `bun fmt` reads the `[fmt]` section of `bunfig.toml`; without it, it formats with Bun's defaults
   * (width 80, double quotes) and rewrites a tree the shared style formatted, and without
   * `flavor = "oxfmt"` it formats like Prettier once oxfmt is not a dependency. A `fmt` script in a
   * `package.json` runs instead of the formatter, and an oxfmt config `bun fmt` finds by itself
   * overrides `[fmt]`; the `oxfmt.config.*` init used to write in `.configs/formatters/` is read by
   * nothing. Warnings, never failures: a project made before `bun fmt` does not start failing.
   */
  static checkFormat(opts: ICheckContext): IViolation[] {
    const warnings: IViolation[] = [];
    const bunfig = join(opts.root, 'bunfig.toml');
    const bunfigText = DoctorCheckUtility.readText({ file: bunfig });

    if (!existsSync(bunfig)) {
      warnings.push(
        DoctorCheckUtility.createViolation({
          check: DoctorChecks.FORMAT,
          file: 'bunfig.toml',
          message: `missing - ${FMT_SECTION_ADVICE}`,
        }),
      );
    } else if (!DoctorConstants.BUNFIG_FMT_SECTION.test(bunfigText)) {
      warnings.push(
        DoctorCheckUtility.createViolation({
          check: DoctorChecks.FORMAT,
          file: 'bunfig.toml',
          message: `no [fmt] section - ${FMT_SECTION_ADVICE}`,
        }),
      );
    } else if (!DoctorConstants.BUNFIG_FMT_FLAVOR.test(bunfigText)) {
      warnings.push(
        DoctorCheckUtility.createViolation({
          check: DoctorChecks.FORMAT,
          file: 'bunfig.toml',
          message: `[fmt] has no flavor = "oxfmt" - ${FMT_FLAVOR_ADVICE}`,
        }),
      );
    }

    for (const owner of formatOwners(opts)) {
      const manifest = join(owner, 'package.json');
      const formatters = join(owner, '.configs', 'formatters');

      if (readScriptNames({ file: join(opts.root, manifest) })?.includes('fmt')) {
        warnings.push(
          DoctorCheckUtility.createViolation({
            check: DoctorChecks.FORMAT,
            file: manifest,
            message:
              'defines a "fmt" script: bun fmt runs it instead of formatting - rename it (the standard names are lint and lint:fix)',
          }),
        );
      }

      const copy = join(owner, 'bunfig.toml');

      if (
        owner !== '.' &&
        DoctorConstants.BUNFIG_FMT_SECTION.test(
          DoctorCheckUtility.readText({ file: join(opts.root, copy) }),
        )
      ) {
        warnings.push(
          DoctorCheckUtility.createViolation({
            check: DoctorChecks.FORMAT,
            file: copy,
            message:
              'a [fmt] copy: bun fmt inherits the root bunfig.toml, and a copy here can drift from it - delete the section',
          }),
        );
      }

      for (const file of DoctorConstants.OXFMT_AUTOLOADED_FILES) {
        if (existsSync(join(opts.root, owner, file))) {
          warnings.push(
            DoctorCheckUtility.createViolation({
              check: DoctorChecks.FORMAT,
              file: join(owner, file),
              message: OXFMT_LOADED_ADVICE,
            }),
          );
        }
      }

      if (existsSync(join(opts.root, formatters))) {
        for (const file of readdirSync(join(opts.root, formatters)).filter((name) =>
          DoctorConstants.OXFMT_CONFIG_FILE.test(name),
        )) {
          warnings.push(
            DoctorCheckUtility.createViolation({
              check: DoctorChecks.FORMAT,
              file: join(formatters, file),
              message:
                'not used any more: bun fmt formats with the [fmt] section of bunfig.toml - delete it',
            }),
          );
        }
      }
    }

    return warnings;
  }
}
