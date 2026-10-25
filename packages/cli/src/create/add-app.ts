import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ExitCodes } from '../common/index.ts';
import {
  describeFolders,
  LayoutKeys,
  layoutFoldersOf,
  layoutOverlapProblems,
  listedFoldersNote,
  withLayoutFolder,
} from '../common/layout-folder.ts';
import type { ILayout } from '../common/layout-folder.ts';
import { loadConfig, resolvePackages } from '../config/index.ts';
import type { IProjectPackage, TResolvedConfig } from '../config/index.ts';
import { readWorkspaceGlobs } from '../init/index.ts';
import { addLibrary } from './add-lib.ts';
import { runAppChecks } from './checks.ts';
import { AppSides, CreateFlags } from './common/index.ts';
import type { IAppsBlock, ILocatedPreset, IPresetSpec, TAppSide } from './common/index.ts';
import { writeFile } from './files.ts';
import { recordedPresetOf } from './lib-preset.ts';
import { renderManifestJson } from './manifest-json.ts';
import { menusAvailable, promptSelect } from '../ui/index.ts';
import { askPresetSpec } from './preset-menu.ts';
import { ABORTED, confirmWrite, planLines } from './plan.ts';
import {
  askInTerminal,
  askScope,
  askWithPrompt,
  nameProblem,
  readFlag,
  readScope,
  resolveNames,
  SIDE_FIELDS,
} from './names.ts';
import { readExistingApps, renderNext } from './next.ts';
import { copyPresetFiles, locatePreset, parsePresetSpec } from './preset.ts';
import { isInstallSkipped, runBun } from './process.ts';
import { installNpmPreset, withScratch } from './scratch.ts';
import {
  addAppBullet,
  checkPeers,
  filePresetWarning,
  parseAppsBlock,
  pickPort,
  planRootManifest,
  presetSpecOf,
  readCatalog,
  readPort,
  recordPreset,
  renderAppConcept,
  renderAppManifest,
  renderKnowledgeIndex,
  replaceAppsBlock,
} from './workspace.ts';

type TRootManifest = Record<string, unknown>;

const KNOWLEDGE_DIRECTORY = '.agents/knowledge';
const ROOT_HINT =
  'run it at the root of a monorepo vulcan init created (no layout in .configs/vulcan.config.*)';

const MISSING_API = `missing ${CreateFlags.API} <app> or ${CreateFlags.NO_API}`;

const fail = (opts: { message: string }): number => {
  process.stderr.write(`vulcan add: ${opts.message}\n`);

  return ExitCodes.FAILURE;
};

/** The side the flags give away: a frontend flag, or only the backend folder; undefined when they do not say. */
const sideNamedBy = (opts: { args: string[] }): TAppSide | undefined => {
  const frontend = [CreateFlags.FRONTEND_DIR, CreateFlags.API, CreateFlags.NO_API].some((flag) =>
    opts.args.includes(flag),
  );
  const backend = opts.args.includes(CreateFlags.BACKEND_DIR);

  if (frontend === backend) {
    return undefined;
  }

  return frontend ? AppSides.FRONTEND : AppSides.BACKEND;
};

/**
 * What the command line already settles, checked before the preset is downloaded: without a terminal
 * to ask, a missing --app, a side folder neither given nor held by the config, or a frontend with
 * neither --api nor --no-api cannot be fixed by the download. The side is known from the flags when
 * they name it; a preset whose side only its package says is checked after the download.
 */
const missingFlag = (opts: { args: string[]; layout: ILayout }): string | undefined => {
  const side = sideNamedBy({ args: opts.args });

  if (readFlag({ args: opts.args, flag: CreateFlags.APP }) === undefined) {
    const kind = side === undefined ? '' : `${side} `;

    return `missing ${CreateFlags.APP} (Name of this ${kind}app) - names are never chosen for you`;
  }

  if (side === undefined) {
    return undefined;
  }

  const folder = SIDE_FIELDS[side];

  const listed = layoutFoldersOf({ value: opts.layout[side] });

  // One listed folder is the answer; none, or several, is for the flag to say.
  if (readFlag({ args: opts.args, flag: folder.flag }) === undefined && listed.length !== 1) {
    return `missing ${folder.flag} (${folder.question}${listed.length > 1 ? `; ${listedFoldersNote({ folders: listed })}` : ''}) - names are never chosen for you`;
  }

  const hasApi = opts.args.includes(CreateFlags.API) || opts.args.includes(CreateFlags.NO_API);

  return side === AppSides.FRONTEND && !hasApi ? MISSING_API : undefined;
};

/** The two commands a project can run for this preset: what `add` prints when it is not told what to create. */
const kindCommands = (opts: { presetValue: string }): string[] => [
  `bun x --no-install vulcan add --preset ${opts.presetValue} ${CreateFlags.APP} <name>`,
  `bun x --no-install vulcan add --preset ${opts.presetValue} ${CreateFlags.LIB} <name>`,
];

const NO_BACKEND = ':none';
const KIND_HINTS: Record<string, string> = { app: 'a runnable app', lib: 'a shared package' };

const SAY_WHAT = `say what to create - \`${CreateFlags.APP} <name>\` (a runnable app) or \`${CreateFlags.LIB} <name>\` (a shared package)`;

/** The terminal asks which kind, listing only what the preset offers; end of input stops the command. */
const askKind = async (opts: { offered: string[] }): Promise<string | undefined> => {
  if (menusAvailable()) {
    const picked = await promptSelect({
      message: 'What do you want to create?',
      choices: opts.offered.map((kind) => ({ value: kind, label: kind, hint: KIND_HINTS[kind] })),
    });

    return picked ?? undefined;
  }

  for (;;) {
    const answer = askWithPrompt({
      question: `What do you want to create? (${opts.offered.join(', ')})`,
    });

    if (answer === null) {
      return undefined;
    }

    const kind = answer.trim();

    if (opts.offered.includes(kind)) {
      return kind;
    }
  }
};

const readRootManifest = (opts: { path: string }): TRootManifest | undefined => {
  if (!existsSync(opts.path)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(opts.path, 'utf8'));
  } catch (error) {
    console.error(
      `[readRootManifest] ${opts.path} | ${error instanceof Error ? error.message : String(error)}`,
    );

    return undefined;
  }
};

/** The lines a user adds by hand when the apps block cannot be extended: only what is new. */
const literal = (opts: {
  side: string;
  /** What the side's layout value becomes: one folder, or the list. */
  folders: string | string[];
  app: IAppsBlock['packages'][number];
  sources: IAppsBlock['sources'];
}): string[] => [
  `  layout: { ${opts.side}: ${typeof opts.folders === 'string' ? `'${opts.folders}'` : `[${opts.folders.map((folder) => `'${folder}'`).join(', ')}]`} },`,
  `  packages: { dir: '${opts.app.dir}', name: '${opts.app.name}', path: '${opts.app.path}' },`,
  ...opts.sources.map(
    (source) =>
      `  sources: { name: '${source.name}', repo: '${source.repo}', ref: '${source.ref}' },`,
  ),
];

/** A frontend's proxy target: the chosen backend app's port, or nothing when it has no backend. */
export const resolveApiUrl = async (opts: {
  root: string;
  args: string[];
  interactive: boolean;
  backendFolders: string[];
  packages: IProjectPackage[];
}): Promise<{ ok: true; apiUrl: string } | { ok: false; error: string }> => {
  if (opts.args.includes(CreateFlags.NO_API)) {
    return { ok: true, apiUrl: '' };
  }

  let chosen = readFlag({ args: opts.args, flag: CreateFlags.API });

  if (chosen === undefined) {
    if (!opts.interactive) {
      return { ok: false, error: MISSING_API };
    }

    if (menusAvailable()) {
      const backends = opts.packages.filter((entry) =>
        opts.backendFolders.some((folder) => entry.path.startsWith(`${folder}/`)),
      );

      // Nothing to pick from: a frontend of a project without a backend has nothing to proxy to.
      if (backends.length === 0) {
        return { ok: true, apiUrl: '' };
      }

      const picked = await promptSelect({
        message: 'Backend app to proxy /api to',
        choices: [
          ...backends.map((entry) => ({ value: entry.dir, label: entry.dir, hint: entry.path })),
          { value: NO_BACKEND, label: 'none', hint: 'no proxy' },
        ],
      });

      if (picked === null) {
        return { ok: false, error: 'aborted' };
      }

      chosen = picked === NO_BACKEND ? '' : picked;
    } else {
      chosen =
        askWithPrompt({ question: 'Backend app to proxy /api to (empty for none)' })?.trim() ?? '';
    }

    if (chosen === '') {
      return { ok: true, apiUrl: '' };
    }
  }

  const backend = opts.packages.find(
    (entry) =>
      entry.dir === chosen &&
      opts.backendFolders.some((folder) => entry.path.startsWith(`${folder}/`)),
  );

  if (backend === undefined) {
    return {
      ok: false,
      error: `${CreateFlags.API} '${chosen}' is not a backend app of this monorepo`,
    };
  }

  const envFile = join(opts.root, backend.path, '.env.example');
  const port = existsSync(envFile)
    ? readPort({ envExample: readFileSync(envFile, 'utf8') })
    : undefined;

  if (port === undefined) {
    return {
      ok: false,
      error: `no *PORT=<number> line in ${backend.path}/.env.example to proxy to`,
    };
  }

  return { ok: true, apiUrl: `http://localhost:${port}` };
};

const usedPorts = (opts: { root: string; packages: IProjectPackage[] }): number[] =>
  readExistingApps({ root: opts.root, paths: opts.packages.map((entry) => entry.path) }).map(
    (app) => app.port,
  );

export const locate = async (opts: {
  cwd: string;
  scratch: string;
  spec: IPresetSpec;
}): Promise<{ ok: true; located: ILocatedPreset } | { ok: false; error: string }> => {
  if (opts.spec.packageName === undefined) {
    return locatePreset({ spec: opts.spec, root: opts.cwd });
  }

  if (isInstallSkipped()) {
    return { ok: false, error: 'an npm preset needs an install - use file: in tests' };
  }

  const installed = await installNpmPreset({ scratch: opts.scratch, spec: opts.spec });

  return installed === ExitCodes.OK
    ? locatePreset({ spec: opts.spec, root: opts.scratch })
    : { ok: false, error: `could not install ${opts.spec.packageName}@${opts.spec.range}` };
};

/** A terminal picks one of the presets the project recorded or an official one, or types another; null when cancelled. */
const askPreset = async (opts: { cwd: string }): Promise<string | null> => {
  const loaded = await loadConfig({ root: opts.cwd });

  return askPresetSpec({ recorded: loaded.ok ? (loaded.config.presets ?? []) : [] });
};

const runAdd = async (opts: { cwd: string; args: string[]; scratch: string }): Promise<number> => {
  const { cwd } = opts;
  const flagged = readFlag({ args: opts.args, flag: CreateFlags.PRESET });

  if (flagged === undefined && !menusAvailable()) {
    return fail({ message: '--preset needs a value (a package name, or file:<path>)' });
  }

  const presetValue = flagged ?? (await askPreset({ cwd }))?.trim();

  if (presetValue === undefined || presetValue === '') {
    return fail({ message: '--preset needs a value (a package name, or file:<path>)' });
  }

  const loaded = await loadConfig({ root: cwd });

  if (!loaded.ok) {
    return fail({ message: loaded.file === undefined ? ROOT_HINT : loaded.error });
  }

  const config: TResolvedConfig = loaded.config;
  const configPath = relative(cwd, loaded.file);
  const manifestPath = join(cwd, 'package.json');
  const manifest = readRootManifest({ path: manifestPath });

  if (config.layout === undefined || manifest === undefined) {
    return fail({ message: ROOT_HINT });
  }

  const interactive = process.stdin.isTTY === true;
  const libFlag = opts.args.includes(CreateFlags.LIB);
  const libName = readFlag({ args: opts.args, flag: CreateFlags.LIB });
  const appFlag = opts.args.includes(CreateFlags.APP);

  if (libFlag && appFlag) {
    return fail({ message: `${CreateFlags.APP} and ${CreateFlags.LIB} cannot be used together` });
  }

  const flaggedScope = readScope({ args: opts.args });

  if (!flaggedScope.ok) {
    return fail({ message: flaggedScope.error });
  }

  if (libFlag && libName === undefined) {
    return fail({ message: `${CreateFlags.LIB} needs a name` });
  }

  // Never a default kind: without a terminal to ask, nothing is fetched or written until the flag says which.
  if (!interactive && !libFlag && !appFlag) {
    return fail({
      message: `${SAY_WHAT}\n  ${kindCommands({ presetValue }).join('\n  ')}`,
    });
  }

  const early =
    interactive || libFlag ? undefined : missingFlag({ args: opts.args, layout: config.layout });

  if (early !== undefined) {
    return fail({ message: early });
  }

  const spec = parsePresetSpec({ value: presetValue, cwd });
  const located = await locate({ cwd, scratch: opts.scratch, spec });

  if (!located.ok) {
    return fail({ message: located.error });
  }

  const { preset, packageName, packageVersion } = located.located;
  const recordedSpec = presetSpecOf({ value: presetValue, root: cwd, cwd });
  let kind = libFlag ? 'lib' : 'app';

  if (!libFlag && !appFlag) {
    const offered = ['app', ...(located.located.libFile === undefined ? [] : ['lib'])];
    const chosen = offered.length === 1 ? 'app' : await askKind({ offered });

    if (chosen === undefined) {
      return fail({ message: SAY_WHAT });
    }

    kind = chosen;
  }

  if (kind === 'lib') {
    const name =
      libName ??
      (
        await askInTerminal({
          question: 'Name of this library',
          validate: (value) =>
            value.trim() === '' ? undefined : nameProblem({ name: value.trim() }),
        })
      )?.trim();

    if (name === undefined || name === '') {
      return fail({ message: `${CreateFlags.LIB} needs a name` });
    }

    return addLibrary({
      cwd,
      args: opts.args,
      interactive,
      presetValue,
      spec,
      located: located.located,
      config,
      configFile: loaded.file,
      configPath,
      manifest,
      packages: resolvePackages({ config }),
      libName: name,
      recorded: ({ block }) =>
        recordPreset({
          block,
          preset: recordedPresetOf({ spec: recordedSpec, located: located.located }),
        }),
    });
  }

  // Before any question: a catalog the preset cannot live in is no reason to ask for names.
  const peerProblem = checkPeers({
    catalog: readCatalog({ manifest }),
    peers: preset.peers,
  });

  if (peerProblem !== undefined) {
    return fail({ message: peerProblem });
  }

  const side = preset.side;
  const listed = layoutFoldersOf({ value: config.layout[side] });
  const [only] = listed;
  const names = await resolveNames({
    fields: [
      // One listed folder is the answer and a menu does not ask; several are picked from; a new one is a flag.
      {
        ...SIDE_FIELDS[side],
        previous: listed.length === 1 ? only : undefined,
        choices: listed.length > 1 ? listed : undefined,
        fixed: menusAvailable() && listed.length === 1,
      },
      { key: 'app', flag: CreateFlags.APP, question: `Name of this ${side} app` },
    ],
    args: opts.args,
    interactive,
    ask: askInTerminal,
  });

  if (!names.ok) {
    return fail({ message: names.error });
  }

  const { folder, app } = names.names;

  const otherSide = Object.entries(config.layout).find(
    ([key, value]) => key !== side && layoutFoldersOf({ value }).includes(folder),
  );

  // One folder holds one kind of code: a folder another key already owns would mix them.
  if (otherSide !== undefined) {
    return fail({
      message:
        otherSide[0] === LayoutKeys.OTHER
          ? `the ${side} folder '${folder}' is listed under layout.other in ${configPath}: folders the layout leaves alone are not app targets`
          : `the ${side} folder '${folder}' is the ${otherSide[0]} folder in ${configPath}; each kind of code needs its own folder`,
    });
  }

  const grown = withLayoutFolder({ value: config.layout[side], folder });
  const overlaps = layoutOverlapProblems({ layout: { ...config.layout, [side]: grown } });

  // A folder inside another (or around one) would give a package path two owners.
  if (overlaps.length > 0) {
    return fail({
      message: `the ${side} folder '${folder}' does not fit the layout of ${configPath}: ${overlaps.join('; ')}`,
    });
  }

  const isNewFolder = !listed.includes(folder);

  // Optional, asked only where menus are drawn; a plain terminal and a script give --scope.
  const scope = flaggedScope.scope ?? (menusAvailable() ? await askScope() : undefined);

  if (scope === null) {
    return fail({ message: ABORTED });
  }

  const packageOfApp = scope === undefined ? app : `${scope}/${app}`;
  const packages = resolvePackages({ config });

  if (
    existsSync(join(cwd, folder, app)) ||
    packages.some((entry) => entry.dir === app || entry.name === packageOfApp)
  ) {
    return fail({ message: `${folder}/${app} already exists` });
  }

  const devPort = pickPort({ preferred: preset.devPort, used: usedPorts({ root: cwd, packages }) });
  let apiUrl = '';

  if (side === AppSides.FRONTEND) {
    const api = await resolveApiUrl({
      root: cwd,
      args: opts.args,
      interactive,
      backendFolders: layoutFoldersOf({ value: config.layout.backend }),
      packages,
    });

    if (!api.ok) {
      return fail({ message: api.error });
    }

    apiUrl = api.apiUrl;
  }

  const source = readFileSync(loaded.file, 'utf8');
  const entry = { dir: app, name: packageOfApp, path: `${folder}/${app}` };
  const knownSources = new Set(config.atlas.sources.map((known) => known.name));
  const newSources = preset.atlas.filter((candidate) => !knownSources.has(candidate.name));
  const parsed = parseAppsBlock({ source });

  // The user's config is theirs: with the block gone or no longer JSON it is never rewritten, only described.
  if (!parsed.ok) {
    return fail({
      message: [
        parsed.reason === 'missing'
          ? `the vulcan:apps block is gone from ${configPath} - add by hand:`
          : `the vulcan:apps block in ${configPath} is not the JSON vulcan wrote - add by hand:`,
        ...literal({ side, folders: grown, app: entry, sources: newSources }),
      ].join('\n'),
    });
  }

  // Extend what the markers hold: the resolved config also carries what the user added outside them.
  const extended: IAppsBlock = {
    layout: {
      ...parsed.block.layout,
      [side]: withLayoutFolder({ value: parsed.block.layout[side], folder }),
    },
    packages: [...parsed.block.packages, entry],
    ...(parsed.block.presets === undefined ? {} : { presets: parsed.block.presets }),
    sources: [
      ...parsed.block.sources,
      ...newSources.filter(
        (candidate) => !parsed.block.sources.some((existing) => existing.name === candidate.name),
      ),
    ],
  };
  const block = recordPreset({
    block: extended,
    preset: recordedPresetOf({ spec: recordedSpec, located: located.located }),
  });
  const replaced = replaceAppsBlock({ source, block });
  // A config written before presets were recorded does not read them yet: the line that does goes in.
  const nextConfig =
    replaced === undefined || replaced.includes('apps.presets')
      ? replaced
      : replaced.replace(
          '  packages: apps.packages,\n',
          '  packages: apps.packages,\n  presets: apps.presets,\n',
        );

  if (nextConfig === undefined) {
    return fail({ message: ROOT_HINT });
  }

  const project = config.name ?? (typeof manifest.name === 'string' ? manifest.name : app);

  const warning = filePresetWarning({ spec, packageName });

  if (warning !== undefined) {
    process.stderr.write(`${warning}\n`);
  }

  const rows: [string, string][] = [['app', `${folder}/${app}`]];

  if (isNewFolder) {
    rows.push([
      'layout',
      `adds '${folder}' to layout.${side} (now ${describeFolders({ folders: layoutFoldersOf({ value: grown }) })})`,
    ]);
  }

  if (scope !== undefined) {
    rows.push(['package', packageOfApp]);
  }

  rows.push(
    ['side', side],
    ['preset', `${packageName} ${packageVersion}`],
    ['port', String(devPort)],
  );

  if (side === AppSides.FRONTEND) {
    rows.push(['proxy', apiUrl === '' ? '(none)' : apiUrl]);
  }

  const confirmed = await confirmWrite({ title: `Add ${app}`, lines: planLines({ rows }) });

  if (!confirmed) {
    return fail({ message: ABORTED });
  }

  copyPresetFiles({
    located: located.located,
    target: join(cwd, folder, app),
    tokens: { project, app, appPath: `${folder}/${app}`, devPort: String(devPort), apiUrl },
  });
  writeFile({
    root: cwd,
    path: `${folder}/${app}/package.json`,
    content: renderAppManifest({
      app,
      name: packageOfApp,
      preset,
      presetPackage: { name: packageName, version: packageVersion },
    }),
  });

  const nextManifest = planRootManifest({
    manifest,
    globs: readWorkspaceGlobs({ root: cwd }),
    folder,
    additions: {
      ...preset.dependencies,
      ...preset.devDependencies,
      [packageName]: spec.packageName === undefined ? spec.range : packageVersion,
    },
  });

  writeFile({
    root: cwd,
    path: 'package.json',
    content: renderManifestJson({ value: nextManifest }),
  });
  writeFile({ root: cwd, path: configPath, content: nextConfig });
  writeFile({
    root: cwd,
    path: `${KNOWLEDGE_DIRECTORY}/packages/${app}.md`,
    content: renderAppConcept({
      app: { name: app, side, folder },
      summary: preset.summary,
      presetPackage: packageName,
    }),
  });
  const indexPath = join(cwd, KNOWLEDGE_DIRECTORY, 'index.md');

  writeFile({
    root: cwd,
    path: `${KNOWLEDGE_DIRECTORY}/index.md`,
    content: existsSync(indexPath)
      ? addAppBullet({
          source: readFileSync(indexPath, 'utf8'),
          app: { name: app, summary: preset.summary },
        })
      : renderKnowledgeIndex({ project, apps: [{ name: app, summary: preset.summary }] }),
  });

  for (const step of [
    () => runBun({ cwd, args: ['install'], label: 'bun install' }),
    // The installed CLI syncs, so the project is wired to the version it pins.
    () =>
      runBun({
        cwd,
        args: [join(cwd, 'node_modules', '.bin', 'vulcan'), 'sync'],
        label: 'vulcan sync',
      }),
    () => runAppChecks({ root: cwd, appDirectory: join(cwd, folder, app), checks: preset.checks }),
  ]) {
    const code = await step();

    if (code !== ExitCodes.OK) {
      return code;
    }
  }

  // Every app `make dev` serves: those that were here, then the new one at the port it was given.
  process.stderr.write(
    renderNext({
      done: `Done. ${folder}/${app} is added.`,
      command: 'make dev',
      apps: [
        ...readExistingApps({ root: cwd, paths: packages.map((existing) => existing.path) }),
        { port: devPort, urls: preset.urls },
      ],
    }),
  );

  return ExitCodes.OK;
};

export const addApp = async (opts: { cwd: string; args: string[] }): Promise<number> =>
  withScratch({ root: opts.cwd, run: (scratch) => runAdd({ ...opts, scratch }) });
