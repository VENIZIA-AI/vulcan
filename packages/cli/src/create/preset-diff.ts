import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { TConstValue } from '../common/index.ts';
import { ExitCodes } from '../common/index.ts';
import { layoutFoldersOf } from '../common/layout-folder.ts';
import type { ILayout } from '../common/layout-folder.ts';
import { loadConfig, resolvePackages } from '../config/index.ts';
import { locate, resolveApiUrl } from './add-app.ts';
import { AppSides, CreateConstants, CreateFlags, PresetDiffStatuses } from './common/index.ts';
import type { ILocatedPreset, IRecordedPreset, IPresetSpec, TAppSide } from './common/index.ts';
import { diffLines } from './diff.ts';
import type { ILineDiff } from './diff.ts';
import { readFlag } from './names.ts';
import {
  decodeText,
  locatePreset,
  parsePresetSpec,
  readJson,
  renderPresetFiles,
} from './preset.ts';
import type { IRenderedPresetFile } from './preset.ts';
import { withScratch } from './scratch.ts';
import { readPort } from './workspace.ts';

const SUBCOMMAND = 'diff';
const USAGE = `usage: vulcan preset ${SUBCOMMAND} <app> [--preset <name|file:path>] [--api <backend app> | --no-api] [--full] [--check]`;
const API_URL_TOKEN = '{{apiUrl}}';
/** Flags that take the next word as their value. */
const VALUE_FLAGS = [CreateFlags.PRESET, CreateFlags.API];

const fail = (opts: { message: string }): number => {
  process.stderr.write(`vulcan preset ${SUBCOMMAND}: ${opts.message}\n`);

  return ExitCodes.FAILURE;
};

/** The side of the app by the layout folder it lives in. */
const sideOf = (opts: { layout: ILayout; path: string }): TAppSide | undefined => {
  const isIn = (side: { folders: string[] }): boolean =>
    side.folders.some((folder) => opts.path.startsWith(`${folder}/`));

  if (isIn({ folders: layoutFoldersOf({ value: opts.layout.backend }) })) {
    return AppSides.BACKEND;
  }

  return isIn({ folders: layoutFoldersOf({ value: opts.layout.frontend }) })
    ? AppSides.FRONTEND
    : undefined;
};

/** The npm package a preset spec stands for: the name in it, or the name inside the folder of a `file:` spec. */
const packageNameOf = (opts: { spec: string; root: string }): string | undefined => {
  const parsed = parsePresetSpec({ value: opts.spec, cwd: opts.root });

  if (parsed.packageName !== undefined) {
    return parsed.packageName;
  }

  const name = readJson({
    file: join(parsed.range.slice(CreateConstants.PRESET_FILE_PREFIX.length), 'package.json'),
  })?.['name'];

  return typeof name === 'string' ? name : undefined;
};

/**
 * The recorded preset an app came from: `add` writes the preset's package into the app's dependencies,
 * and the config records the presets of the project, so the one of the app's side whose package the app
 * depends on is it. Records of one package under two specs (`api`, then `api@2`) are one preset.
 * Nothing else is guessed: no match, or two packages, asks for `--preset`.
 */
export const detectPreset = (opts: {
  root: string;
  recorded: IRecordedPreset[];
  dependencies: string[];
  side: TAppSide;
}): { ok: true; spec: string } | { ok: false; error: string } => {
  const matching = new Map<string, string>();

  for (const preset of opts.recorded) {
    const name = packageNameOf({ spec: preset.spec, root: opts.root });

    if (preset.side === opts.side && name !== undefined && opts.dependencies.includes(name)) {
      // The last record of a package wins: it is the newest spec `add` wrote.
      matching.set(name, preset.spec);
    }
  }

  const [only] = [...matching.values()];

  if (matching.size === 1 && only !== undefined) {
    return { ok: true, spec: only };
  }

  const known =
    opts.recorded.length === 0
      ? 'the config records no preset'
      : `recorded: ${opts.recorded.map((preset) => preset.spec).join(', ')}`;

  return {
    ok: false,
    error: `${matching.size === 0 ? "no recorded preset of the app's side is a dependency of the app" : 'more than one recorded preset fits the app'} (${known}) - say which with ${CreateFlags.PRESET} <name|file:path>`,
  };
};

export interface IPresetFileReport {
  path: string;
  status: TConstValue<typeof PresetDiffStatuses>;
  diff?: ILineDiff;
  /** Both files are not text, so there is a status and no diff. */
  isBinary?: boolean;
  /** The app has a folder where the preset has a file. */
  isFolder?: boolean;
}

/** Each file the preset makes, set against the file the app has at the same path. Reads only. */
export const comparePresetFiles = (opts: {
  rendered: IRenderedPresetFile[];
  appDirectory: string;
}): IPresetFileReport[] =>
  [...opts.rendered]
    .sort((first, second) => first.path.localeCompare(second.path))
    .map((file): IPresetFileReport => {
      const target = join(opts.appDirectory, file.path);

      if (!existsSync(target)) {
        return { path: file.path, status: PresetDiffStatuses.MISSING };
      }

      if (statSync(target).isDirectory()) {
        return { path: file.path, status: PresetDiffStatuses.DIFFERS, isFolder: true };
      }

      const current = readFileSync(target);

      if (current.equals(file.content)) {
        return { path: file.path, status: PresetDiffStatuses.SAME };
      }

      const currentText = decodeText({ content: current });
      const presetText = decodeText({ content: file.content });

      return currentText === undefined || presetText === undefined
        ? { path: file.path, status: PresetDiffStatuses.DIFFERS, isBinary: true }
        : {
            path: file.path,
            status: PresetDiffStatuses.DIFFERS,
            diff: diffLines({ current: currentText, preset: presetText }),
          };
    });

const describeDifference = (opts: { report: IPresetFileReport }): string => {
  const { diff, isBinary, isFolder } = opts.report;

  if (isFolder === true) {
    return '(the app has a folder here)';
  }

  if (isBinary === true) {
    return '(binary)';
  }

  if (diff === undefined) {
    return '';
  }

  if (diff.hunks === undefined) {
    return '(too large to diff)';
  }

  return diff.added === 0 && diff.removed === 0
    ? '(line endings or the last newline)'
    : `(+${diff.added} -${diff.removed})`;
};

const printReport = (opts: {
  appPath: string;
  located: ILocatedPreset;
  source: string;
  reports: IPresetFileReport[];
  isFull: boolean;
}): void => {
  const { reports } = opts;
  const countOf = (status: string): number =>
    reports.filter((report) => report.status === status).length;
  const lines = [
    `vulcan preset ${SUBCOMMAND}: ${opts.appPath} against ${opts.located.packageName}@${opts.located.packageVersion} (${opts.source})`,
  ];

  for (const report of reports) {
    const note = report.status === PresetDiffStatuses.DIFFERS ? describeDifference({ report }) : '';

    lines.push(`  ${report.status.padEnd(8)} ${report.path}${note === '' ? '' : `  ${note}`}`);

    if (opts.isFull && report.diff?.hunks !== undefined && report.diff.hunks.length > 0) {
      lines.push(
        `    --- ${opts.appPath}/${report.path} (the app)`,
        `    +++ ${report.path} (the preset)`,
        ...report.diff.hunks.flatMap((hunk) => hunk.split('\n').map((line) => `    ${line}`)),
      );
    }
  }

  lines.push(
    `${reports.length} file${reports.length === 1 ? '' : 's'}: ${countOf(PresetDiffStatuses.SAME)} same, ${countOf(PresetDiffStatuses.DIFFERS)} differ, ${countOf(PresetDiffStatuses.MISSING)} missing in the app`,
  );
  process.stdout.write(`${lines.join('\n')}\n`);
};

/** The value of a flag that takes one: undefined when the flag is absent, an error when it is repeated or has no value. */
const readValue = (opts: {
  args: string[];
  flag: string;
}): { ok: true; value: string | undefined } | { ok: false; error: string } => {
  const count = opts.args.filter((arg) => arg === opts.flag).length;

  if (count === 0) {
    return { ok: true, value: undefined };
  }

  const value = readFlag({ args: opts.args, flag: opts.flag });

  if (count > 1) {
    return { ok: false, error: `${opts.flag} is given more than once` };
  }

  return value === undefined || value.startsWith('-')
    ? { ok: false, error: `${opts.flag} needs a value` }
    : { ok: true, value };
};

/** The installed copy of an npm preset: in the app's own `node_modules` (bun's isolated linker) or the monorepo root's. */
const locateInstalled = (opts: { spec: IPresetSpec; appDirectory: string; root: string }) => {
  const inApp = locatePreset({ spec: opts.spec, root: opts.appDirectory });

  return inApp.ok ? inApp : locatePreset({ spec: opts.spec, root: opts.root });
};

export const runPresetDiff = async (opts: { cwd: string; args: string[] }): Promise<number> => {
  const { cwd, args } = opts;
  const positionals = args.filter(
    (arg, index) => !arg.startsWith('-') && !VALUE_FLAGS.includes(args[index - 1] ?? ''),
  );
  const [subcommand, appName] = positionals;

  if (subcommand !== SUBCOMMAND || appName === undefined) {
    return fail({ message: USAGE });
  }

  const presetFlag = readValue({ args, flag: CreateFlags.PRESET });
  const apiFlag = readValue({ args, flag: CreateFlags.API });

  if (!presetFlag.ok || !apiFlag.ok) {
    return fail({ message: !presetFlag.ok ? presetFlag.error : apiFlag.ok ? '' : apiFlag.error });
  }

  const loaded = await loadConfig({ root: cwd });

  if (!loaded.ok) {
    return fail({
      message:
        loaded.file === undefined
          ? 'run it at the root of a monorepo vulcan init created (no .configs/vulcan.config.*)'
          : loaded.error,
    });
  }

  const { config } = loaded;
  const packages = resolvePackages({ config });
  const app = packages.find((entry) => entry.dir === appName || entry.path === appName);

  if (config.layout === undefined || app === undefined) {
    const known = packages.filter((entry) => entry.kind !== 'lib').map((entry) => entry.dir);

    return fail({
      message: `no app '${appName}' in the config packages${known.length === 0 ? '' : ` (apps: ${known.join(', ')})`}`,
    });
  }

  const side = sideOf({ layout: config.layout, path: app.path });

  if (side === undefined) {
    return fail({ message: `${app.path} is not in a backend or frontend folder of the layout` });
  }

  const appDirectory = join(cwd, app.path);
  const appManifest = readJson({ file: join(appDirectory, 'package.json') });

  if (appManifest === undefined) {
    return fail({ message: `${app.path}/package.json is missing or not JSON` });
  }

  const dependencies = appManifest['dependencies'];
  const detected =
    presetFlag.value === undefined
      ? detectPreset({
          root: cwd,
          recorded: config.presets ?? [],
          dependencies: Object.keys(
            typeof dependencies === 'object' && dependencies !== null ? dependencies : {},
          ),
          side,
        })
      : undefined;

  if (detected !== undefined && !detected.ok) {
    return fail({ message: detected.error });
  }

  const rootManifest = readJson({ file: join(cwd, 'package.json') });
  const project =
    config.name ?? (typeof rootManifest?.['name'] === 'string' ? rootManifest['name'] : app.dir);
  const envFile = join(appDirectory, '.env.example');
  const ownPort = existsSync(envFile)
    ? readPort({ envExample: readFileSync(envFile, 'utf8') })
    : undefined;

  const compare = async (found: { located: ILocatedPreset; source: string }): Promise<number> => {
    const { located } = found;
    const tokens: Record<string, string> = {
      project,
      app: app.dir,
      appPath: app.path,
      devPort: String(ownPort ?? located.preset.devPort),
    };
    let rendered = renderPresetFiles({ located, tokens });
    const usesApiUrl = rendered.some((file) =>
      (decodeText({ content: file.content }) ?? '').includes(API_URL_TOKEN),
    );

    if (usesApiUrl) {
      const api = await resolveApiUrl({
        root: cwd,
        args,
        interactive: false,
        backendFolders: layoutFoldersOf({ value: config.layout?.backend }),
        packages,
      });

      if (!api.ok) {
        return fail({
          message: `${api.error} (the files of this preset use the proxy target, as they did when add made the app)`,
        });
      }

      rendered = renderPresetFiles({ located, tokens: { ...tokens, apiUrl: api.apiUrl } });
    }

    const reports = comparePresetFiles({ rendered, appDirectory });

    printReport({
      appPath: app.path,
      located,
      source: found.source,
      reports,
      isFull: args.includes(CreateFlags.FULL),
    });

    return args.includes(CreateFlags.CHECK) &&
      reports.some((report) => report.status !== PresetDiffStatuses.SAME)
      ? ExitCodes.FAILURE
      : ExitCodes.OK;
  };

  const value = presetFlag.value ?? (detected?.ok === true ? detected.spec : '');
  const spec = parsePresetSpec({ value, cwd });
  // `name@range` is fetched; a bare name, a detected spec or a `file:` folder is read where it already is.
  const isFetched = presetFlag.value !== undefined && presetFlag.value.lastIndexOf('@') > 0;

  if (isFetched) {
    return withScratch({
      root: cwd,
      run: async (scratch) => {
        const located = await locate({ cwd, scratch, spec });

        return located.ok
          ? compare({
              located: located.located,
              source: `fetched ${spec.packageName}@${spec.range}`,
            })
          : fail({ message: located.error });
      },
    });
  }

  const located =
    spec.packageName === undefined
      ? locatePreset({ spec, root: cwd })
      : locateInstalled({ spec, appDirectory, root: cwd });

  if (!located.ok) {
    return fail({
      message: `${located.error}${spec.packageName === undefined ? '' : ` - run bun install, or give ${CreateFlags.PRESET} ${spec.packageName}@<range> to fetch it`}`,
    });
  }

  return compare({
    located: located.located,
    source:
      spec.packageName === undefined
        ? `file:${spec.range.slice(CreateConstants.PRESET_FILE_PREFIX.length)}`
        : 'installed in node_modules',
  });
};
