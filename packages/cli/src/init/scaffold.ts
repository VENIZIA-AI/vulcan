import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { BASE_DIRECTORY, ProjectLayout, readProperty } from '../common/index.ts';
import { ConfigConstants, findConfigFiles } from '../config/index.ts';
import type { TConfigExtension } from '../config/index.ts';
import { InitConstants, InitStatuses } from './common/index.ts';
import { renderDockerignore } from '../create/dockerignore.ts';
import type { IInitEntry, IScaffoldFile } from './common/index.ts';

/**
 * Whether a `.mcp.json` already serves atlas: a server named `atlas`, or any server whose arguments run
 * `atlas mcp` under another name, as separate arguments or inside a `sh -c` string. A file that is not JSON falls back to looking for the name.
 */
export const runsAtlas = (opts: { text: string }): boolean => {
  try {
    const parsed: { mcpServers?: Record<string, { args?: unknown }> } = JSON.parse(opts.text);
    const servers = parsed.mcpServers ?? {};

    return (
      'atlas' in servers ||
      Object.values(servers).some(server => {
        const args = Array.isArray(server.args)
          ? server.args.flatMap(arg => String(arg).split(/\s+/))
          : [];
        const atlas = args.indexOf('atlas');

        return atlas !== -1 && args[atlas + 1] === 'mcp';
      })
    );
  } catch {
    return opts.text.includes('"atlas"');
  }
};

/** The entry for a `.mcp.json` that exists already: atlas serves the knowledge bundle alone, and the wiki when there is one. */
export const MCP_SERVER_HINT =
  '"atlas": { "command": "bun", "args": ["x", "--no-install", "vulcan", "x", "atlas", "mcp", "--root", "."] }';

/** The files every project gets, apart from the config, whose format the user picks. */
const SCAFFOLD_FILES: IScaffoldFile[] = [
  { path: 'AGENTS.md', template: 'AGENTS.md' },
  { path: '.agents/rules.md', template: 'rules.md' },
  { path: '.agents/knowledge/index.md', template: 'knowledge-index.md' },
  { path: '.mcp.json', template: 'mcp.json' },
];

/** The lint configs of a single-package project. A workspaces project keeps them in each app. */
const LINT_CONFIG_FILES: IScaffoldFile[] = [
  { path: '.configs/lints/oxlint.config.mts', template: 'oxlint.config.mts' },
  { path: '.configs/lints/eslint.config.mjs', template: 'eslint.config.mjs' },
  { path: '.configs/formatters/oxfmt.config.mts', template: 'oxfmt.config.mts' },
];

export interface IScaffoldResult {
  entries: IInitEntry[];
  /** Packages to `bun add -d`, empty when everything is declared. */
  install: string[];
  /** What is left for the user, in order. */
  todo: string[];
}

interface IPackageManifest {
  name?: unknown;
  workspaces?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const readManifest = (opts: { root: string }): IPackageManifest | undefined => {
  const file = join(opts.root, 'package.json');

  if (!existsSync(file)) {
    return undefined;
  }

  try {
    const manifest: IPackageManifest = JSON.parse(readFileSync(file, 'utf8'));

    return manifest;
  } catch (error) {
    console.error(
      `[readManifest] ${file} is not valid JSON - using the directory name | ${error instanceof Error ? error.message : String(error)}`,
    );

    return undefined;
  }
};

/** Whether the root `package.json` declares workspaces: the array form or `{ packages: [...] }`. */
export const declaresWorkspaces = (opts: { root: string }): boolean => {
  const workspaces = readManifest(opts)?.workspaces;

  return Array.isArray(workspaces) || (typeof workspaces === 'object' && workspaces !== null);
};

/** The root workspace globs, from either form; empty when there are none. */
export const readWorkspaceGlobs = (opts: { root: string }): string[] => {
  const workspaces = readManifest(opts)?.workspaces;

  if (Array.isArray(workspaces)) {
    return workspaces.map(String);
  }

  const packages = readProperty({ value: workspaces, key: 'packages' });

  return Array.isArray(packages) ? packages.map(String) : [];
};

/**
 * Whether a workspace glob list covers the packages directly under `folder`: `folder/*` or
 * `folder/**`, with or without a leading `./`.
 */
export const coversFolder = (opts: { globs: string[]; folder: string }): boolean =>
  opts.globs.some(glob => {
    const plain = glob.replace(/^\.\//, '');

    return plain === `${opts.folder}/*` || plain === `${opts.folder}/**`;
  });

/** The `package.json` name, or the directory name when there is none. */
export const resolveProjectName = (opts: { root: string }): string => {
  const name = readManifest(opts)?.name;

  return typeof name === 'string' && name !== '' ? name : basename(opts.root);
};

export const renderTemplate = (opts: { template: string; name: string }): string =>
  readFileSync(join(BASE_DIRECTORY, 'templates', opts.template), 'utf8').replaceAll(
    InitConstants.NAME_TOKEN,
    opts.name,
  );

const writeIfAbsent = (opts: { root: string; path: string; content: string }): IInitEntry => {
  const target = join(opts.root, opts.path);

  if (existsSync(target)) {
    return { status: InitStatuses.KEPT, subject: opts.path };
  }

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, opts.content);

  return { status: InitStatuses.CREATED, subject: opts.path };
};

/** Scaffolds the project layer at `root`. Never overwrites: an existing file is kept and a needed edit becomes a hint; only `.gitignore` is appended to, line by line. */
export const scaffoldProject = (opts: {
  root: string;
  extension: TConfigExtension;
}): IScaffoldResult => {
  const { root } = opts;
  const name = resolveProjectName({ root });
  const isWorkspaces = declaresWorkspaces({ root });
  const entries: IInitEntry[] = (
    isWorkspaces ? SCAFFOLD_FILES : [...SCAFFOLD_FILES, ...LINT_CONFIG_FILES]
  ).map(file =>
    writeIfAbsent({
      root,
      path: file.path,
      content: renderTemplate({ template: file.template, name }),
    }),
  );

  if (isWorkspaces) {
    entries.push({
      status: InitStatuses.SKIPPED,
      subject: `.configs/{lints,formatters}: a workspaces project keeps them per app (apps/<name>/.configs/lints/, apps/<name>/.configs/formatters/); the templates are in node_modules/@venizia/vulcan/base/templates/`,
    });
  }

  const configs = findConfigFiles({ root });

  if (configs.length === 0) {
    const configFile = `${ConfigConstants.BASENAME}.${opts.extension}`;

    entries.push(
      writeIfAbsent({
        root,
        path: join(ConfigConstants.DIRECTORY, configFile),
        content: renderTemplate({ template: configFile, name }),
      }),
    );
  } else {
    entries.push(
      ...configs.map((file): IInitEntry => ({
        status: InitStatuses.KEPT,
        subject: relative(root, file),
      })),
    );
  }

  entries.push(writeIfAbsent({ root, path: '.dockerignore', content: renderDockerignore() }));

  const makefile = join(root, 'Makefile');

  if (!existsSync(makefile)) {
    entries.push(
      writeIfAbsent({
        root,
        path: 'Makefile',
        content: renderTemplate({ template: 'Makefile', name }),
      }),
    );
  } else if (!readFileSync(makefile, 'utf8').includes(ProjectLayout.MAKE_INCLUDE_LINE)) {
    entries.push({
      status: InitStatuses.ADD,
      subject: `Makefile: ${ProjectLayout.MAKE_INCLUDE_LINE}`,
    });
  }

  // A `.mcp.json` that was already there is the project's: it gets the atlas entry as a hint, never an edit.
  if (
    !entries.some(entry => entry.subject === '.mcp.json' && entry.status === InitStatuses.CREATED)
  ) {
    const servers = readFileSync(join(root, '.mcp.json'), 'utf8');

    if (!runsAtlas({ text: servers })) {
      entries.push({
        status: InitStatuses.ADD,
        subject: `.mcp.json: the atlas server, for the knowledge bundle (and the wiki, when there is one; --root pins the project): ${MCP_SERVER_HINT}`,
      });
    }
  }

  const gitignore = join(root, '.gitignore');
  const existing = existsSync(gitignore) ? readFileSync(gitignore, 'utf8') : '';
  const lines = existing.split('\n');
  const missingIgnores = ProjectLayout.GITIGNORE_ENTRIES.filter(entry => !lines.includes(entry));

  if (missingIgnores.length > 0) {
    const separator = existing === '' || existing.endsWith('\n') ? '' : '\n';

    writeFileSync(gitignore, `${existing}${separator}${missingIgnores.join('\n')}\n`);
    entries.push({
      status: InitStatuses.UPDATED,
      subject: `.gitignore: + ${missingIgnores.join(' ')}`,
    });
  }

  const manifest = readManifest({ root });
  const declared = { ...manifest?.dependencies, ...manifest?.devDependencies };
  const needed = isWorkspaces
    ? [ProjectLayout.STYLE_PACKAGE]
    : [...ProjectLayout.LINT_TOOLS, ProjectLayout.STYLE_PACKAGE];
  const install = needed.filter(packageName => !(packageName in declared));
  const todo = [
    `describe the project in ${ConfigConstants.DEFAULT_KNOWLEDGE_BUNDLE}/index.md, then delete the ${ProjectLayout.SCAFFOLD_MARKER} line`,
    ...entries
      .filter(entry => entry.status === InitStatuses.ADD)
      .map(entry => `add ${entry.subject}`),
    `${ProjectLayout.VULCAN_COMMAND} sync && ${ProjectLayout.VULCAN_COMMAND} doctor`,
  ];

  return { entries, install, todo };
};
