import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ExitCodes, ProjectLayout, VULCAN_VERSION } from '../common/index.ts';
import { renderTemplate } from '../init/index.ts';
import { runAppChecks } from './checks.ts';
import { AppSides, CreateFlags } from './common/index.ts';
import type {
  IAppsBlock,
  ILocatedPreset,
  INameField,
  IPresetSpec,
  TAppSide,
} from './common/index.ts';
import { today, writeFile } from './files.ts';
import { recordedPresetOf } from './lib-preset.ts';
import { askWithPrompt, findFolderClash, readFlag, resolveNames, SIDE_FIELDS } from './names.ts';
import { copyPresetFiles, locatePreset, parsePresetSpec } from './preset.ts';
import { renderNext } from './next.ts';
import { isInstallSkipped, runBun, runGitInit } from './process.ts';
import { installNpmPreset, withScratch } from './scratch.ts';
import {
  filePresetWarning,
  renderAppConcept,
  renderAppManifest,
  renderKnowledgeIndex,
  renderLogEntry,
  renderRootManifest,
  presetSpecOf,
  renderVulcanConfig,
} from './workspace.ts';

/** The VULCAN layer files; the knowledge index is rendered from the apps, not copied. */
const LAYER_FILES = [
  { path: 'AGENTS.md', template: 'AGENTS.md' },
  { path: '.agents/rules.md', template: 'rules.md' },
  { path: '.mcp.json', template: 'mcp.json' },
  { path: 'Makefile', template: 'Makefile' },
];

/** `make dev` is the one command the Done message promises; the shipped Makefile has no such target. */
const DEV_TARGET = '\ndev:\n\t@bun run dev\n';

const BASE_IGNORES = ['node_modules/', 'dist/', '.env', '*.tsbuildinfo'];

const fail = (opts: { message: string }): number => {
  process.stderr.write(`vulcan init: ${opts.message}\n`);

  return ExitCodes.FAILURE;
};

/** A folder that holds anything, or is not a folder, is not a place to create a project. */
const isOccupied = (opts: { path: string }): boolean =>
  existsSync(opts.path) &&
  (!statSync(opts.path).isDirectory() || readdirSync(opts.path).length > 0);

const appFields = (opts: { side?: TAppSide }): INameField[] => [
  ...(opts.side === undefined ? [] : [SIDE_FIELDS[opts.side]]),
  {
    key: 'app',
    flag: CreateFlags.APP,
    question: opts.side === undefined ? 'Name of the first app' : `Name of this ${opts.side} app`,
  },
  {
    key: 'shared',
    flag: CreateFlags.SHARED_DIR,
    question: 'Shared code folder (empty to skip)',
    optional: true,
  },
];

const writeMonorepo = (opts: {
  root: string;
  project: string;
  spec: IPresetSpec;
  /** `--preset` as the user typed it, recorded so the project can name it again. */
  presetValue: string;
  located: ILocatedPreset;
  folder: string;
  app: string;
  shared: string;
}): void => {
  const { root, project, spec, presetValue, located, folder, app, shared } = opts;
  const { preset, packageName, packageVersion } = located;
  const side = preset.side;
  const catalog = {
    ...preset.dependencies,
    ...preset.devDependencies,
    [packageName]: spec.packageName === undefined ? spec.range : packageVersion,
  };

  writeFile({
    root,
    path: 'package.json',
    content: renderRootManifest({
      project,
      workspaces: [`${folder}/*`, ...(shared === '' ? [] : [`${shared}/*`])],
      catalog,
      vulcanVersion: VULCAN_VERSION,
    }),
  });
  writeFile({
    root,
    path: '.gitignore',
    content: `${[...BASE_IGNORES, ...ProjectLayout.GITIGNORE_ENTRIES].join('\n')}\n`,
  });
  writeFile({ root, path: 'README.md', content: `# ${project}\n` });

  if (shared !== '') {
    writeFile({ root, path: `${shared}/.gitkeep`, content: '' });
  }

  // The first app: nothing uses a port yet, and a frontend has no backend to proxy to.
  const appDirectory = join(root, folder, app);
  const written = copyPresetFiles({
    located,
    target: appDirectory,
    tokens: { project, app, devPort: String(preset.devPort), apiUrl: '' },
  });

  for (const path of written) {
    process.stderr.write(`  created  ${folder}/${app}/${path}\n`);
  }

  writeFile({
    root,
    path: `${folder}/${app}/package.json`,
    content: renderAppManifest({
      app,
      preset,
      presetPackage: { name: packageName, version: packageVersion },
    }),
  });

  for (const file of LAYER_FILES) {
    const content = renderTemplate({ template: file.template, name: project });

    writeFile({
      root,
      path: file.path,
      content: file.path === 'Makefile' ? `${content}${DEV_TARGET}` : content,
    });
  }

  const block: IAppsBlock = {
    layout: { [side]: folder, ...(shared === '' ? {} : { shared }) },
    packages: [{ dir: app, name: app, path: `${folder}/${app}` }],
    presets: [
      recordedPresetOf({
        spec: presetSpecOf({ value: presetValue, root, cwd: dirname(root) }),
        located,
      }),
    ],
    sources: preset.atlas,
  };

  writeFile({
    root,
    path: '.configs/vulcan.config.mts',
    content: renderVulcanConfig({ project, block }),
  });
  writeFile({
    root,
    path: '.agents/knowledge/index.md',
    content: renderKnowledgeIndex({ project, apps: [{ name: app, summary: preset.summary }] }),
  });
  writeFile({
    root,
    path: `.agents/knowledge/packages/${app}.md`,
    content: renderAppConcept({
      app: { name: app, side, folder },
      summary: preset.summary,
      presetPackage: packageName,
    }),
  });
  writeFile({
    root,
    path: '.agents/knowledge/log.md',
    content: `# ${project} knowledge log\n\n${renderLogEntry({
      date: today(),
      text: `created from the ${packageName} ${packageVersion} preset: ${folder}/${app}`,
    })}`,
  });
};

const runCreate = async (opts: {
  cwd: string;
  args: string[];
  scratch: string;
}): Promise<number> => {
  const presetValue = readFlag({ args: opts.args, flag: CreateFlags.PRESET });

  if (presetValue === undefined) {
    return fail({ message: '--preset needs a value (a package name, or file:<path>)' });
  }

  const spec = parsePresetSpec({ value: presetValue, cwd: opts.cwd });
  const interactive = process.stdin.isTTY === true;
  const first = resolveNames({
    fields: [
      { key: 'project', flag: CreateFlags.PROJECT, question: 'Project name (the monorepo folder)' },
    ],
    args: opts.args,
    interactive,
    ask: askWithPrompt,
  });

  if (!first.ok) {
    return fail({ message: first.error });
  }

  const project = first.names.project;
  const root = join(opts.cwd, project);

  // Before any write: init only ever creates a project, so a folder with content is the user's.
  if (isOccupied({ path: root })) {
    return fail({
      message: `${project} exists and is not empty - init --preset only creates a new project`,
    });
  }

  const isNpm = spec.packageName !== undefined;

  if (isNpm && isInstallSkipped()) {
    return fail({ message: 'an npm preset needs an install - use file: in tests' });
  }

  let located: ILocatedPreset;

  if (isNpm) {
    // Without a terminal nothing is asked, so a missing flag is refused before the network is used.
    if (!interactive) {
      const early = resolveNames({
        fields: appFields({}),
        args: opts.args,
        interactive,
        ask: askWithPrompt,
      });

      if (!early.ok) {
        return fail({ message: early.error });
      }
    }

    // The side is known only once the package is read, so the preset is fetched before the rest is asked.
    const installed = await installNpmPreset({ scratch: opts.scratch, spec });

    if (installed !== ExitCodes.OK) {
      return installed;
    }

    const result = locatePreset({ spec, root: opts.scratch });

    if (!result.ok) {
      return fail({ message: result.error });
    }

    located = result.located;
  } else {
    const result = locatePreset({ spec, root });

    if (!result.ok) {
      return fail({ message: result.error });
    }

    located = result.located;
  }

  const rest = resolveNames({
    fields: appFields({ side: located.preset.side }),
    args: opts.args,
    interactive,
    ask: askWithPrompt,
  });

  if (!rest.ok) {
    return fail({ message: rest.error });
  }

  const { folder, app, shared } = rest.names;
  const side = located.preset.side;
  // The flag of the side this preset does not build still counts when given: it names a folder too.
  const otherFlag =
    SIDE_FIELDS[side === AppSides.BACKEND ? AppSides.FRONTEND : AppSides.BACKEND].flag;
  const otherFolder = readFlag({ args: opts.args, flag: otherFlag });
  const clash = findFolderClash({
    folders: [
      { flag: SIDE_FIELDS[side].flag, value: folder },
      ...(otherFolder === undefined ? [] : [{ flag: otherFlag, value: otherFolder }]),
      ...(shared === '' ? [] : [{ flag: CreateFlags.SHARED_DIR, value: shared }]),
    ],
  });

  if (clash !== undefined) {
    return fail({ message: clash });
  }

  const warning = filePresetWarning({
    spec,
    packageName: located.packageName,
  });

  if (warning !== undefined) {
    process.stderr.write(`${warning}\n`);
  }

  writeMonorepo({ root, project, spec, presetValue, located, folder, app, shared });

  for (const step of [
    () => runBun({ cwd: root, args: ['install'], label: 'bun install' }),
    () => runGitInit({ cwd: root }),
    // The installed CLI syncs, so the project is wired to the version it pins.
    () =>
      runBun({
        cwd: root,
        args: [join(root, 'node_modules', '.bin', 'vulcan'), 'sync'],
        label: 'vulcan sync',
      }),
    () =>
      runAppChecks({
        root,
        appDirectory: join(root, folder, app),
        checks: located.preset.checks,
      }),
  ]) {
    const code = await step();

    if (code !== ExitCodes.OK) {
      return code;
    }
  }

  // The preset's own port: nothing else is in this project yet, so it is the one the app listens on.
  process.stderr.write(
    renderNext({
      done: 'Done.',
      command: `cd ${project} && make dev`,
      apps: [{ port: located.preset.devPort, urls: located.preset.urls }],
    }),
  );

  return ExitCodes.OK;
};

export const createMonorepo = async (opts: { cwd: string; args: string[] }): Promise<number> =>
  withScratch({ run: scratch => runCreate({ ...opts, scratch }) });
