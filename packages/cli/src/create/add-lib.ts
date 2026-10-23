import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ExitCodes } from '../common/index.ts';
import type { IProjectPackage, TResolvedConfig } from '../config/index.ts';
import { readWorkspaceGlobs } from '../init/index.ts';
import { runAppChecks } from './checks.ts';
import { CreateConstants, CreateFlags } from './common/index.ts';
import type { IAppsBlock, ILocatedPreset, IPresetSpec } from './common/index.ts';
import { today, writeFile } from './files.ts';
import { readLibPreset } from './lib-preset.ts';
import { renderManifestJson } from './manifest-json.ts';
import type { TLibPreset } from './lib-preset.ts';
import { ABORTED, confirmWrite, planLines } from './plan.ts';
import { askInTerminal, readFlag, SCOPE_PATTERN } from './names.ts';
import { copyPresetFiles } from './preset.ts';
import { runBun } from './process.ts';
import {
  addAppBullet,
  filePresetWarning,
  parseAppsBlock,
  planRootManifest,
  renderKnowledgeIndex,
  renderLibConcept,
  renderLibManifest,
  renderLogEntry,
  replaceAppsBlock,
} from './workspace.ts';

const KNOWLEDGE_DIRECTORY = '.agents/knowledge';
const DIRECTORY_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const fail = (opts: { message: string }): number => {
  process.stderr.write(`vulcan add: ${opts.message}\n`);

  return ExitCodes.FAILURE;
};

/** A folder from the root, written with slashes, never climbing out or absolute. */
const isProjectFolder = (opts: { folder: string }): boolean =>
  opts.folder
    .replace(/\/+$/, '')
    .split('/')
    .every(segment => DIRECTORY_SEGMENT.test(segment) && segment !== '..');

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
  const given = readFlag({ args: opts.args, flag: CreateFlags.DIR });
  const libFolders = [
    ...new Set(
      opts.packages
        .filter(entry => entry.kind === 'lib' && !entry.retired)
        .map(entry => dirname(entry.path)),
    ),
  ];
  const fallback =
    opts.config.layout?.shared ?? (libFolders.length === 1 ? libFolders[0] : undefined);
  let chosen = given;

  if (chosen === undefined) {
    if (opts.interactive) {
      // The folders the project's libraries already live in are picked; a new one is typed.
      const answer =
        (
          await askInTerminal({
            question: 'Folder',
            previous: fallback,
            choices: [...new Set([...(fallback === undefined ? [] : [fallback]), ...libFolders])],
          })
        )?.trim() ?? '';

      chosen = answer === '' ? fallback : answer;
    } else {
      chosen = fallback;
    }
  }

  if (chosen === undefined) {
    return { ok: false, error: `where should ${opts.lib} go? pass ${CreateFlags.DIR} <folder>` };
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
  const given = readFlag({ args: opts.args, flag: CreateFlags.SCOPE });

  if (given !== undefined) {
    return SCOPE_PATTERN.test(given)
      ? { ok: true, name: `${given}/${opts.lib}` }
      : { ok: false, error: `${CreateFlags.SCOPE} '${given}' is not a scope like @acme` };
  }

  const siblings = opts.packages.filter(
    entry => !entry.retired && dirname(entry.path) === opts.folder,
  );
  const scopes = [...new Set(siblings.map(entry => scopeOf({ name: entry.name })))].sort();

  if (scopes.length > 1) {
    return {
      ok: false,
      error: `the packages in ${opts.folder} use more than one scope (${scopes.map(scope => scope || 'unscoped').join(', ')}) - pass ${CreateFlags.SCOPE} <@scope>`,
    };
  }

  const scope = scopes.length === 1 ? scopes[0] : rootScope({ manifest: opts.manifest });

  return { ok: true, name: scope === '' ? opts.lib : `${scope}/${opts.lib}` };
};

/** The sibling-name rule needs the entries the config holds, not only the folder's directories. */
export const addLibrary = async (opts: {
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
  recorded: (opts: { block: IAppsBlock }) => IAppsBlock;
}): Promise<number> => {
  const { cwd, config, located, libName } = opts;

  if (!CreateConstants.NAME_PATTERN.test(libName)) {
    return fail({
      message: `'${libName}' is not a name - lowercase letters, digits and -, starting with a letter or digit`,
    });
  }

  const read = readLibPreset({ located });

  if (!read.ok) {
    return fail({ message: read.error });
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
    return fail({ message: placed.error });
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
    return fail({ message: named.error });
  }

  const path = `${folder}/${libName}`;

  if (
    existsSync(join(cwd, path)) ||
    opts.packages.some(entry => entry.dir === libName || entry.name === named.name)
  ) {
    return fail({ message: `${path} already exists` });
  }

  const source = readFileSync(opts.configFile, 'utf8');
  const parsed = parseAppsBlock({ source });

  if (!parsed.ok) {
    return fail({
      message:
        parsed.reason === 'missing'
          ? `the vulcan:apps block is gone from ${opts.configPath} - add the package by hand: { dir: '${libName}', name: '${named.name}', path: '${path}', kind: 'lib' }`
          : `the vulcan:apps block in ${opts.configPath} is not the JSON vulcan wrote - add the package by hand: { dir: '${libName}', name: '${named.name}', path: '${path}', kind: 'lib' }`,
    });
  }

  const block = opts.recorded({
    block: {
      ...parsed.block,
      packages: [...parsed.block.packages, { dir: libName, name: named.name, path, kind: 'lib' }],
    },
  });
  const replaced = replaceAppsBlock({ source, block });
  const nextConfig =
    replaced === undefined || replaced.includes('apps.presets')
      ? replaced
      : replaced.replace(
          '  packages: apps.packages,\n',
          '  packages: apps.packages,\n  presets: apps.presets,\n',
        );

  if (nextConfig === undefined) {
    return fail({ message: `the vulcan:apps block of ${opts.configPath} cannot be rewritten` });
  }

  const project =
    config.name ?? (typeof opts.manifest.name === 'string' ? opts.manifest.name : libName);
  const warning = filePresetWarning({ spec: opts.spec, packageName: located.packageName });

  if (warning !== undefined) {
    process.stderr.write(`${warning}\n`);
  }

  const confirmed = await confirmWrite({
    title: `Add ${libName}`,
    lines: planLines({
      rows: [
        ['library', path],
        ['package', named.name],
        ['preset', `${located.packageName} ${located.packageVersion}`],
      ],
    }),
  });

  if (!confirmed) {
    return fail({ message: ABORTED });
  }

  const written = copyPresetFiles({
    located,
    files: lib.files,
    target: join(cwd, path),
    tokens: { project, lib: libName, package: named.name },
  });

  for (const file of written) {
    process.stderr.write(`  created  ${path}/${file}\n`);
  }

  writeFile({
    root: cwd,
    path: `${path}/package.json`,
    content: renderLibManifest({ name: named.name, lib }),
  });

  const nextManifest = planRootManifest({
    manifest: opts.manifest,
    globs: readWorkspaceGlobs({ root: cwd }),
    folder,
    additions: { ...lib.dependencies, ...lib.devDependencies, ...lib.peerDependencies },
  });

  writeFile({
    root: cwd,
    path: 'package.json',
    content: renderManifestJson({ value: nextManifest }),
  });
  writeFile({ root: cwd, path: opts.configPath, content: nextConfig });
  writeFile({
    root: cwd,
    path: `${KNOWLEDGE_DIRECTORY}/packages/${libName}.md`,
    content: renderLibConcept({
      name: libName,
      path,
      summary: lib.summary,
      presetPackage: located.packageName,
    }),
  });

  const indexPath = join(cwd, KNOWLEDGE_DIRECTORY, 'index.md');

  writeFile({
    root: cwd,
    path: `${KNOWLEDGE_DIRECTORY}/index.md`,
    content: existsSync(indexPath)
      ? addAppBullet({
          source: readFileSync(indexPath, 'utf8'),
          app: { name: libName, summary: lib.summary },
        })
      : renderKnowledgeIndex({ project, apps: [{ name: libName, summary: lib.summary }] }),
  });

  const logPath = join(cwd, KNOWLEDGE_DIRECTORY, 'log.md');
  const logEntry = renderLogEntry({
    date: today(),
    text: `added ${path} from the ${located.packageName} ${located.packageVersion} preset (lib kind)`,
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
    () =>
      runBun({
        cwd,
        args: [join(cwd, 'node_modules', '.bin', 'vulcan'), 'sync'],
        label: 'vulcan sync',
      }),
    () => runAppChecks({ root: cwd, appDirectory: join(cwd, path), checks: lib.checks }),
  ]) {
    const code = await step();

    if (code !== ExitCodes.OK) {
      return code;
    }
  }

  process.stderr.write(`Done. ${path} is added.\n`);

  return ExitCodes.OK;
};
