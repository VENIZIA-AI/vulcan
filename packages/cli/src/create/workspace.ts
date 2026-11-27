import { relative, resolve } from 'node:path';
import { ProjectLayout } from '../common/constants.ts';
import { RecordValue } from '../common/record.ts';
import { ProjectScaffold } from '../init/index.ts';
import { CreateConstants } from './common/index.ts';
import { ManifestJson } from './manifest-json.ts';
import type { IAppsBlock, IPreset, IRecordedPreset } from './common/index.ts';

const ENV_PORT = /^[A-Z0-9_]*PORT=(\d+)\s*$/m;

const toStringRecord = (opts: { value: unknown }): Record<string, string> =>
  RecordValue.isRecord(opts.value)
    ? Object.fromEntries(
        Object.entries(opts.value).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      )
    : {};

const toCatalog = (opts: { dependencies: Record<string, string> }): Record<string, string> =>
  Object.fromEntries(
    Object.keys(opts.dependencies)
      .sort()
      .map((name) => [name, 'catalog:']),
  );

export class WorkspaceManifest {
  static renderRoot(opts: {
    project: string;
    workspaces: string[];
    catalog: Record<string, string>;
    vulcanVersion: string;
  }): string {
    return ManifestJson.render({
      value: {
        name: opts.project,
        private: true,
        workspaces: { packages: opts.workspaces, catalog: opts.catalog },
        scripts: {
          dev: "bun run --filter '*' server:dev",
          prepare: ProjectLayout.PREPARE_SCRIPT,
        },
        devDependencies: { '@venizia/vulcan': opts.vulcanVersion },
      },
    });
  }

  /** A version the monorepo already pins wins, so every app shares one copy. */
  static mergeCatalog(opts: {
    catalog: Record<string, string>;
    additions: Record<string, string>;
  }): Record<string, string> {
    return { ...opts.additions, ...opts.catalog };
  }

  /** The catalog of a root manifest wherever it lives: top level, or inside object-form workspaces. */
  static readCatalog(opts: { manifest: Record<string, unknown> }): Record<string, string> {
    return {
      ...(RecordValue.isRecord(opts.manifest.workspaces)
        ? toStringRecord({ value: opts.manifest.workspaces.catalog })
        : {}),
      ...toStringRecord({ value: opts.manifest.catalog }),
    };
  }

  /**
   * The root manifest with the new folder and the preset's catalog entries added, and nothing else
   * changed: an array of workspaces stays an array, and the catalog stays where the project keeps it
   * (top level, or inside object-form workspaces; an array has no room for one, so top level).
   */
  static planRoot(opts: {
    manifest: Record<string, unknown>;
    globs: string[];
    folder: string;
    additions: Record<string, string>;
  }): Record<string, unknown> {
    const { manifest, folder } = opts;
    const { workspaces } = manifest;
    const globs = ProjectScaffold.coversFolder({ globs: opts.globs, folder })
      ? opts.globs
      : [...opts.globs, `${folder}/*`];
    const existing = WorkspaceManifest.readCatalog({ manifest });
    const fresh = Object.fromEntries(
      Object.entries(opts.additions).filter(([name]) => existing[name] === undefined),
    );
    const isTopLevel = RecordValue.isRecord(manifest.catalog) || Array.isArray(workspaces);

    if (isTopLevel) {
      return {
        ...manifest,
        workspaces: Array.isArray(workspaces)
          ? globs
          : { ...(RecordValue.isRecord(workspaces) ? workspaces : {}), packages: globs },
        catalog: WorkspaceManifest.mergeCatalog({
          catalog: toStringRecord({ value: manifest.catalog }),
          additions: fresh,
        }),
      };
    }

    const inside = RecordValue.isRecord(workspaces) ? workspaces : {};

    return {
      ...manifest,
      workspaces: {
        ...inside,
        packages: globs,
        catalog: WorkspaceManifest.mergeCatalog({
          catalog: toStringRecord({ value: inside.catalog }),
          additions: fresh,
        }),
      },
    };
  }

  /**
   * The catalog value is read as the version the install resolves to, compared with the preset's
   * range by semver order (what Bun.semver implements). A prerelease sorts before its release, so
   * `^0.2.2-5` does not meet `^0.2.2`: it is refused, never rounded up. A value that is not a plain
   * version (`workspace:*`, a git URL, a range) cannot be compared, so it is refused as well.
   */
  static checkPeers(opts: {
    catalog: Record<string, string>;
    peers: Record<string, string>;
    /** What the preset itself lists, so the catalog `init` wrote from it is not held to its own range. */
    presetVersions?: Pick<IPreset, 'dependencies' | 'devDependencies'>;
  }): string | undefined {
    for (const [name, range] of Object.entries(opts.peers)) {
      const pinned = opts.catalog[name];

      if (pinned === undefined) {
        continue;
      }

      // A pin equal to the version this preset lists is satisfied by construction (`init` wrote it
      // from the preset); only a pin set by something else is compared with the range.
      if (
        pinned === opts.presetVersions?.dependencies[name] ||
        pinned === opts.presetVersions?.devDependencies[name]
      ) {
        continue;
      }

      const version = pinned.replace(/^[\^~]/, '');

      if (!CreateConstants.VERSION_PATTERN.test(version)) {
        return `the monorepo pins ${name} ${pinned}, which is not a version vulcan can compare with the preset's ${range} - pin a version in the catalog first`;
      }

      if (!Bun.semver.satisfies(version, range)) {
        return CreateConstants.PRERELEASE_PATTERN.test(version)
          ? `the monorepo pins ${name} ${pinned}, a prerelease, which does not meet the preset's ${range} (a prerelease sorts before its release) - pin a release in the catalog first`
          : `the monorepo pins ${name} ${pinned}, but the preset needs ${range} - move the catalog first`;
      }
    }

    return undefined;
  }

  static renderApp(opts: {
    app: string;
    /** The package name when it is not the app name: `@scope/<app>`. */
    name?: string;
    preset: IPreset;
    presetPackage: { name: string; version: string };
  }): string {
    return ManifestJson.render({
      value: {
        name: opts.name ?? opts.app,
        version: '0.0.0',
        private: true,
        // The preset's own text: no token is replaced here, a path pattern has no use for one.
        ...(Object.keys(opts.preset.imports).length === 0 ? {} : { imports: opts.preset.imports }),
        scripts: opts.preset.scripts,
        dependencies: toCatalog({
          dependencies: {
            ...opts.preset.dependencies,
            [opts.presetPackage.name]: opts.presetPackage.version,
          },
        }),
        devDependencies: toCatalog({ dependencies: opts.preset.devDependencies }),
        // What `add` prints later: this app's urls, since the preset is not at hand then.
        ...(opts.preset.urls.length === 0 ? {} : { vulcan: { urls: opts.preset.urls } }),
      },
    });
  }

  /** A library's package.json: generated fields first, then what the lib preset passes through. */
  static renderLib(opts: {
    name: string;
    lib: {
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      peerDependencies: Record<string, string>;
      imports: Record<string, string>;
      exports: Record<string, unknown>;
      packageFields: Record<string, unknown>;
    };
  }): string {
    const { lib } = opts;
    const section = (value: Record<string, unknown>, key: string): Record<string, unknown> =>
      Object.keys(value).length === 0 ? {} : { [key]: value };

    return ManifestJson.render({
      value: {
        name: opts.name,
        version: '0.0.0',
        private: true,
        ...lib.packageFields,
        ...section(lib.exports, 'exports'),
        ...section(lib.imports, 'imports'),
        ...section(lib.scripts, 'scripts'),
        ...section(toCatalog({ dependencies: lib.dependencies }), 'dependencies'),
        ...section(toCatalog({ dependencies: lib.devDependencies }), 'devDependencies'),
        ...section(toCatalog({ dependencies: lib.peerDependencies }), 'peerDependencies'),
      },
    });
  }
}

export class PresetRecord {
  /**
   * What `--preset` was given, kept so it can be typed again from the project root: a package spec as
   * typed, a `file:` path made relative to the project.
   */
  static presetSpecOf(opts: { value: string; root: string; cwd: string }): string {
    const prefix = CreateConstants.PRESET_FILE_PREFIX;

    if (!opts.value.startsWith(prefix)) {
      return opts.value;
    }

    const target = resolve(opts.cwd, opts.value.slice(prefix.length));

    return `${prefix}${relative(opts.root, target) || '.'}`;
  }

  /** The block with this preset recorded: once per spec, its side and summary refreshed. */
  static record(opts: { block: IAppsBlock; preset: IRecordedPreset }): IAppsBlock {
    const others = opts.block.presets.filter((item) => item.spec !== opts.preset.spec);
    const index = opts.block.presets.findIndex((item) => item.spec === opts.preset.spec);
    const presets =
      index === -1
        ? [...others, opts.preset]
        : opts.block.presets.map((item, at) => (at === index ? opts.preset : item));

    return { ...opts.block, presets };
  }
}

export class PortRegistry {
  static pick(opts: { preferred: number; used: number[] }): number {
    let port = opts.preferred;

    while (opts.used.includes(port)) {
      port++;
    }

    return port;
  }

  static read(opts: { envExample: string }): number | undefined {
    const match = ENV_PORT.exec(opts.envExample);

    return match === null ? undefined : Number(match[1]);
  }
}
