import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { BASE_DIRECTORY, ProjectLayout } from '../common/index.ts';
import { ConfigConstants, findConfigFiles } from '../config/index.ts';
import type { TConfigExtension } from '../config/index.ts';
import { InitConstants, InitStatuses } from './common/index.ts';
import type { IInitEntry, IScaffoldFile } from './common/index.ts';

/** Atlas serves the knowledge bundle alone, and the wiki and changelogs when there are any. */
const MCP_SERVER_HINT =
  '"atlas": { "command": "bun", "args": ["x", "--no-install", "vulcan", "x", "atlas", "mcp", "--root", "."] }';

/** The files every project gets, apart from the config, whose format the user picks. */
const SCAFFOLD_FILES: IScaffoldFile[] = [
  { path: 'AGENTS.md', template: 'AGENTS.md' },
  { path: '.agents/rules.md', template: 'rules.md' },
  { path: '.agents/knowledge/index.md', template: 'knowledge-index.md' },
];

/** The lint configs of a single-package project. A workspaces project keeps them in each app. */
const LINT_CONFIG_FILES: IScaffoldFile[] = [
  { path: '.configs/oxlint.config.mts', template: 'oxlint.config.mts' },
  { path: '.configs/eslint.config.mjs', template: 'eslint.config.mjs' },
  { path: '.configs/oxfmt.config.mts', template: 'oxfmt.config.mts' },
];

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

/** The `package.json` name, or the directory name when there is none. */
export const resolveProjectName = (opts: { root: string }): string => {
  const name = readManifest(opts)?.name;

  return typeof name === 'string' && name !== '' ? name : basename(opts.root);
};

const renderTemplate = (opts: { template: string; name: string }): string =>
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

/** Scaffolds the project layer at `root`. Never overwrites: an existing file is kept and a needed edit becomes a hint. */
export const scaffoldProject = (opts: {
  root: string;
  extension: TConfigExtension;
}): IInitEntry[] => {
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
      subject: `.configs/{oxlint,eslint,oxfmt}: a workspaces project keeps them per app (apps/<name>/.configs/); the templates are in node_modules/@venizia/vulcan/base/templates/`,
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

  const makefile = join(root, 'Makefile');

  if (!existsSync(makefile)) {
    entries.push(
      writeIfAbsent({ root, path: 'Makefile', content: `${ProjectLayout.MAKE_INCLUDE_LINE}\n` }),
    );
  } else if (!readFileSync(makefile, 'utf8').includes(ProjectLayout.MAKE_INCLUDE_LINE)) {
    entries.push({
      status: InitStatuses.ADD,
      subject: `Makefile: ${ProjectLayout.MAKE_INCLUDE_LINE}`,
    });
  }

  entries.push({
    status: InitStatuses.ADD,
    subject: `.mcp.json, for atlas over the knowledge bundle (and the wiki, when there is one; --root pins the project): ${MCP_SERVER_HINT}`,
  });

  const gitignore = join(root, '.gitignore');
  const ignored = existsSync(gitignore) ? readFileSync(gitignore, 'utf8').split('\n') : [];
  const missingIgnores = ProjectLayout.GITIGNORE_ENTRIES.filter(entry => !ignored.includes(entry));

  if (missingIgnores.length > 0) {
    entries.push({ status: InitStatuses.ADD, subject: `.gitignore: ${missingIgnores.join(' ')}` });
  }

  const manifest = readManifest({ root });

  if (
    !(ProjectLayout.STYLE_PACKAGE in { ...manifest?.dependencies, ...manifest?.devDependencies })
  ) {
    entries.push({
      status: InitStatuses.ADD,
      subject: `devDependency: bun add -d --exact ${ProjectLayout.STYLE_PACKAGE}`,
    });
  }

  return entries;
};
