import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseYamlMapping, splitFrontmatter } from '@venizia/vulcan-okf';
import { ExitCodes } from '../common/index.ts';
import { loadConfig, resolvePackages } from '../config/index.ts';
import type { IProjectPackage, TResolvedConfig } from '../config/index.ts';
import { runAppChecks } from './checks.ts';
import { AppSides, CreateFlags } from './common/index.ts';
import type { IAppsBlock, ILocatedPreset, IPresetSpec } from './common/index.ts';
import { today, writeFile } from './files.ts';
import { askWithPrompt, readFlag, resolveNames, SIDE_FIELDS } from './names.ts';
import { copyPresetFiles, locatePreset, parsePresetSpec } from './preset.ts';
import { isInstallSkipped, runBun } from './process.ts';
import { installNpmPreset, withScratch } from './scratch.ts';
import {
  checkPeers,
  mergeCatalog,
  pickPort,
  readPort,
  renderAppConcept,
  renderAppManifest,
  renderKnowledgeIndex,
  renderLogEntry,
  replaceAppsBlock,
} from './workspace.ts';

interface IRootManifest {
  name?: string;
  workspaces?: { packages?: string[]; catalog?: Record<string, string> };
  [key: string]: unknown;
}

const KNOWLEDGE_DIRECTORY = '.agents/knowledge';
const ROOT_HINT =
  'run it at the root of a monorepo vulcan init created (no layout in .configs/vulcan.config.*)';

const fail = (opts: { message: string }): number => {
  process.stderr.write(`vulcan add: ${opts.message}\n`);

  return ExitCodes.FAILURE;
};

const readRootManifest = (opts: { path: string }): IRootManifest | undefined => {
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

/** The index line of an app already in the monorepo: the description its own concept carries. */
const readSummary = (opts: { root: string; entry: IProjectPackage }): string => {
  const file = join(opts.root, KNOWLEDGE_DIRECTORY, 'packages', `${opts.entry.name}.md`);
  const { yaml } = splitFrontmatter({ text: existsSync(file) ? readFileSync(file, 'utf8') : '' });
  const parsed = parseYamlMapping({ yaml: yaml ?? '' });
  const description = parsed.ok ? parsed.data.description : undefined;

  return typeof description === 'string' ? description : opts.entry.path;
};

const literal = (opts: { block: IAppsBlock }): string[] => {
  const layout = Object.entries(opts.block.layout)
    .map(([side, folder]) => `${side}: '${folder}'`)
    .join(', ');
  const packages = opts.block.packages.map(
    entry => `    { dir: '${entry.dir}', name: '${entry.name}', path: '${entry.path}' },`,
  );

  return [`  layout: { ${layout} },`, '  packages: [', ...packages, '  ],'];
};

/** A frontend's proxy target: the chosen backend app's port, or nothing when it has no backend. */
const resolveApiUrl = (opts: {
  root: string;
  args: string[];
  interactive: boolean;
  backendFolder: string | undefined;
  packages: IProjectPackage[];
}): { ok: true; apiUrl: string } | { ok: false; error: string } => {
  if (opts.args.includes(CreateFlags.NO_API)) {
    return { ok: true, apiUrl: '' };
  }

  let chosen = readFlag({ args: opts.args, flag: CreateFlags.API });

  if (chosen === undefined) {
    if (!opts.interactive) {
      return { ok: false, error: `missing ${CreateFlags.API} <app> or ${CreateFlags.NO_API}` };
    }

    chosen =
      askWithPrompt({ question: 'Backend app to proxy /api to (empty for none)' })?.trim() ?? '';

    if (chosen === '') {
      return { ok: true, apiUrl: '' };
    }
  }

  const backend = opts.packages.find(
    entry =>
      entry.dir === chosen &&
      opts.backendFolder !== undefined &&
      entry.path.startsWith(`${opts.backendFolder}/`),
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
  opts.packages.flatMap(entry => {
    const envFile = join(opts.root, entry.path, '.env.example');
    const port = existsSync(envFile)
      ? readPort({ envExample: readFileSync(envFile, 'utf8') })
      : undefined;

    return port === undefined ? [] : [port];
  });

const locate = async (opts: {
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

const runAdd = async (opts: { cwd: string; args: string[]; scratch: string }): Promise<number> => {
  const { cwd } = opts;
  const presetValue = readFlag({ args: opts.args, flag: CreateFlags.PRESET });

  if (presetValue === undefined) {
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

  const spec = parsePresetSpec({ value: presetValue, cwd });
  const located = await locate({ cwd, scratch: opts.scratch, spec });

  if (!located.ok) {
    return fail({ message: located.error });
  }

  const { preset, packageName, packageVersion } = located.located;
  // Before any question: a catalog the preset cannot live in is no reason to ask for names.
  const peerProblem = checkPeers({
    catalog: manifest.workspaces?.catalog ?? {},
    peers: preset.peers,
  });

  if (peerProblem !== undefined) {
    return fail({ message: peerProblem });
  }

  const interactive = process.stdin.isTTY === true;
  const side = preset.side;
  const previous = config.layout[side];
  const names = resolveNames({
    fields: [
      { ...SIDE_FIELDS[side], previous },
      { key: 'app', flag: CreateFlags.APP, question: `Name of this ${side} app` },
    ],
    args: opts.args,
    interactive,
    ask: askWithPrompt,
  });

  if (!names.ok) {
    return fail({ message: names.error });
  }

  const { folder, app } = names.names;

  // layout holds one folder per side, so a different answer would strand the apps already there.
  if (previous !== undefined && folder !== previous) {
    return fail({
      message: `the ${side} folder is '${previous}' in ${configPath}; apps of one side share it, not '${folder}'`,
    });
  }

  const packages = resolvePackages({ config });

  if (existsSync(join(cwd, folder, app)) || packages.some(entry => entry.dir === app)) {
    return fail({ message: `${folder}/${app} already exists` });
  }

  const devPort = pickPort({ preferred: preset.devPort, used: usedPorts({ root: cwd, packages }) });
  let apiUrl = '';

  if (side === AppSides.FRONTEND) {
    const api = resolveApiUrl({
      root: cwd,
      args: opts.args,
      interactive,
      backendFolder: config.layout.backend,
      packages,
    });

    if (!api.ok) {
      return fail({ message: api.error });
    }

    apiUrl = api.apiUrl;
  }

  const block: IAppsBlock = {
    layout: { ...config.layout, [side]: folder },
    packages: [
      ...packages.map(entry => ({ dir: entry.dir, name: entry.name, path: entry.path })),
      { dir: app, name: app, path: `${folder}/${app}` },
    ],
    sources: [
      ...config.atlas.sources,
      ...preset.atlas.filter(
        source => !config.atlas.sources.some(existing => existing.name === source.name),
      ),
    ],
  };
  const source = readFileSync(loaded.file, 'utf8');
  const nextConfig = replaceAppsBlock({ source, block });

  // The user's config is theirs: with the markers gone it is never rewritten, only described.
  if (nextConfig === undefined) {
    return fail({
      message: [
        `the vulcan:apps block is gone from ${configPath} - add by hand:`,
        ...literal({ block }),
      ].join('\n'),
    });
  }

  const project = config.name ?? manifest.name ?? app;

  copyPresetFiles({
    located: located.located,
    target: join(cwd, folder, app),
    tokens: { project, app, devPort: String(devPort), apiUrl },
  });
  writeFile({
    root: cwd,
    path: `${folder}/${app}/package.json`,
    content: renderAppManifest({
      app,
      preset,
      presetPackage: { name: packageName, version: packageVersion },
    }),
  });

  const workspacePackages = manifest.workspaces?.packages ?? [];
  const nextManifest: IRootManifest = {
    ...manifest,
    workspaces: {
      packages: workspacePackages.includes(`${folder}/*`)
        ? workspacePackages
        : [...workspacePackages, `${folder}/*`],
      catalog: mergeCatalog({
        catalog: manifest.workspaces?.catalog ?? {},
        additions: {
          ...preset.dependencies,
          ...preset.devDependencies,
          [packageName]: spec.packageName === undefined ? spec.range : packageVersion,
        },
      }),
    },
  };

  writeFile({
    root: cwd,
    path: 'package.json',
    content: `${JSON.stringify(nextManifest, null, 2)}\n`,
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
  writeFile({
    root: cwd,
    path: `${KNOWLEDGE_DIRECTORY}/index.md`,
    content: renderKnowledgeIndex({
      project,
      apps: [
        ...packages.map(entry => ({
          name: entry.name,
          summary: readSummary({ root: cwd, entry }),
        })),
        { name: app, summary: preset.summary },
      ],
    }),
  });

  const logPath = join(cwd, KNOWLEDGE_DIRECTORY, 'log.md');
  const logEntry = renderLogEntry({
    date: today(),
    text: `added ${folder}/${app} from the ${packageName} ${packageVersion} preset`,
  });

  writeFile({
    root: cwd,
    path: `${KNOWLEDGE_DIRECTORY}/log.md`,
    content: existsSync(logPath)
      ? `${readFileSync(logPath, 'utf8').trimEnd()}\n\n${logEntry}`
      : `# ${project} knowledge log\n\n${logEntry}`,
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

  process.stderr.write(`Done. ${folder}/${app} is added.\n`);

  return ExitCodes.OK;
};

export const addApp = async (opts: { cwd: string; args: string[] }): Promise<number> =>
  withScratch({ run: scratch => runAdd({ ...opts, scratch }) });
