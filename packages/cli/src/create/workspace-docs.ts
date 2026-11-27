import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { RecordValue } from '../common/record.ts';
import { LibraryTypes, PackageTypes } from '../config/index.ts';
import type { TLibraryType } from '../config/index.ts';
import { AppsBlockProblems, CreateConstants } from './common/index.ts';
import type { IApp, IAppsBlock, IPresetSpec, TAppSide, TAppsBlockProblem } from './common/index.ts';

/** A newline inside a list item or a paragraph would split it. */
const oneLine = (opts: { text: string }): string => opts.text.replace(/\s+/g, ' ').trim();

/** The atlas lookups a package of one kind depends on: what a summary page cannot hold. */
const ATLAS_LOOKUPS: Record<TAppSide | typeof PackageTypes.LIB, [string, string][]> = {
  backend: [
    ['How a route and its controller are written', '`search` "controller routes", then `get`'],
    [
      'How a service, a repository and a datasource fit together',
      '`search` "service repository datasource"',
    ],
  ],
  frontend: [
    ['How a page or a resource is added', '`search` "page resource", then `get`'],
    ['How the app reads data from its backend', '`search` "data provider"'],
  ],
  lib: [['How a library exposes its API', '`search` "library exports", then `get`']],
};

/** The note and the table that turn a package page into a pointer at atlas, for its kind. */
const renderAtlasLookups = (opts: { kind: TAppSide | typeof PackageTypes.LIB }): string[] => [
  '> This page is a summary, not a spec: it says what the package is. How code is written here lives',
  '> in atlas; look it up before you explain or write code.',
  '',
  '## How things are done here',
  '',
  '| You need | Ask atlas |',
  '|---|---|',
  ...ATLAS_LOOKUPS[opts.kind].map(([need, call]) => `| ${need} | ${call} |`),
  '| The signature and import path of an export, before you import it | `symbol` with its name |',
  '| A new app or package | `presets`, then the `vulcan package add` command it returns |',
  '',
];

const renderAppBullet = (opts: { app: { name: string; summary: string } }): string =>
  `- [${opts.app.name}](packages/${opts.app.name}.md) - ${oneLine({ text: opts.app.summary })}`;

const hasStrings = (opts: { value: unknown; keys: string[] }): boolean => {
  const { value } = opts;

  return RecordValue.isRecord(value) && opts.keys.every((key) => typeof value[key] === 'string');
};

const isRecordedPreset = (value: unknown): boolean =>
  hasStrings({ value, keys: ['spec', 'side', 'summary'] }) &&
  RecordValue.isRecord(value) &&
  (value.side === 'backend' || value.side === 'frontend') &&
  (value.lib === undefined || typeof value.lib === 'string') &&
  (value.shared === undefined || typeof value.shared === 'string');

const isAppsBlock = (value: unknown): value is IAppsBlock =>
  RecordValue.isRecord(value) &&
  Array.isArray(value.presets) &&
  value.presets.every((entry) => isRecordedPreset(entry)) &&
  RecordValue.isRecord(value.layout) &&
  Object.values(value.layout).every(
    (folders) =>
      typeof folders === 'string' ||
      (Array.isArray(folders) && folders.every((folder) => typeof folder === 'string')),
  ) &&
  Array.isArray(value.packages) &&
  value.packages.every(
    (entry) =>
      hasStrings({ value: entry, keys: ['dir', 'name', 'path'] }) &&
      RecordValue.isRecord(entry) &&
      (entry.presetType === undefined ||
        (typeof entry.presetType === 'string' && LibraryTypes.isValid(entry.presetType))),
  ) &&
  Array.isArray(value.sources) &&
  value.sources.every((entry) => hasStrings({ value: entry, keys: ['name', 'repo', 'ref'] }));

const APPS_DECLARATION = 'const apps = ';

const APPS_HEADING = /^## Apps\s*$/;

const ANY_HEADING = /^#{1,2}\s/;

export class AppsBlock {
  /**
   * The block is JSON that `add` reads back with `JSON.parse`, so `bun fmt` must not rewrite it
   * (it would drop the key quotes): `prettier-ignore` is honoured by both of its flavors.
   */
  static render(opts: {
    block: IAppsBlock;
    /** `export const apps`, for a module another module of the config imports it from. */ isExported?: boolean;
  }): string {
    return [
      CreateConstants.APPS_BLOCK_START,
      '// prettier-ignore',
      `${opts.isExported === true ? 'export ' : ''}const apps = ${JSON.stringify(opts.block, null, 2)};`,
      CreateConstants.APPS_BLOCK_END,
    ].join('\n');
  }

  /**
   * Where the block is: in the config file, or in `.configs/vulcan/project.mts` (what `vulcan project init --preset` writes). Only files
   * under `.configs/` are read, with every link followed; `undefined` when neither holds the markers.
   */
  static locate(opts: {
    root: string;
    configFile: string;
  }): { path: string; source: string } | { outside: string } | undefined {
    const folder = join(realpathSync(opts.root), '.configs');
    let outside: string | undefined;
    const candidates = [relative(opts.root, opts.configFile), `.configs/vulcan/project.mts`];

    for (const path of candidates) {
      const file = join(opts.root, path);

      if (!existsSync(file)) {
        continue;
      }

      const real = realpathSync(file);

      if (!real.startsWith(`${folder}${sep}`)) {
        outside = path;
        continue;
      }

      const source = readFileSync(file, 'utf8');

      if (source.includes(CreateConstants.APPS_BLOCK_START)) {
        return { path, source };
      }
    }

    return outside === undefined ? undefined : { outside };
  }

  /** Only the text between the markers is rewritten; undefined when the user edited them away. */
  static replace(opts: { source: string; block: IAppsBlock }): string | undefined {
    const start = opts.source.indexOf(CreateConstants.APPS_BLOCK_START);
    const end = opts.source.indexOf(CreateConstants.APPS_BLOCK_END);

    if (start === -1 || end === -1 || end < start) {
      return undefined;
    }

    const before = opts.source.slice(0, start);
    const after = opts.source.slice(end + CreateConstants.APPS_BLOCK_END.length);

    // The declaration stays as the file had it: `export const apps` when another module imports it.
    const isExported = opts.source.slice(start, end).includes('export const apps = ');

    return `${before}${AppsBlock.render({ block: opts.block, isExported })}${after}`;
  }

  /** What the markers hold now, so `add` extends it instead of rebuilding it from the resolved config. */
  static parse(opts: { source: string }): TAppsBlockResult {
    const start = opts.source.indexOf(CreateConstants.APPS_BLOCK_START);
    const end = opts.source.indexOf(CreateConstants.APPS_BLOCK_END);

    if (start === -1 || end === -1 || end < start) {
      return { ok: false, reason: AppsBlockProblems.MISSING };
    }

    const body = opts.source.slice(start + CreateConstants.APPS_BLOCK_START.length, end);
    const declaration = body.indexOf(APPS_DECLARATION);

    if (declaration === -1) {
      return { ok: false, reason: AppsBlockProblems.INVALID };
    }

    try {
      const parsed: unknown = JSON.parse(
        body
          .slice(declaration + APPS_DECLARATION.length)
          .trim()
          .replace(/;$/, ''),
      );

      return isAppsBlock(parsed)
        ? { ok: true, block: parsed }
        : { ok: false, reason: AppsBlockProblems.INVALID };
    } catch (error) {
      console.error(
        `[AppsBlock.parse] the vulcan:apps block is not JSON | ${error instanceof Error ? error.message : String(error)}`,
      );

      return { ok: false, reason: AppsBlockProblems.INVALID };
    }
  }

  /**
   * One bullet for one app, after the last bullet under `## Apps` (a section is added when the index
   * has none). Every other byte of the index is the user's and is returned as it was.
   */
  static addBullet(opts: { source: string; app: { name: string; summary: string } }): string {
    if (opts.source.includes(`](packages/${opts.app.name}.md)`)) {
      return opts.source;
    }

    const eol = opts.source.includes('\r\n') ? '\r\n' : '\n';
    const bullet = renderAppBullet({ app: opts.app });
    const lines = opts.source.split(eol);
    const heading = lines.findIndex((line) => APPS_HEADING.test(line));

    if (heading === -1) {
      const kept = opts.source.trimEnd();

      return `${kept === '' ? '' : `${kept}${eol}${eol}`}## Apps${eol}${eol}${bullet}${eol}`;
    }

    const next = lines.findIndex((line, index) => index > heading && ANY_HEADING.test(line));
    const section = lines.slice(heading + 1, next === -1 ? lines.length : next);
    const last = section.findLastIndex((line) => line.startsWith('- ['));

    if (last === -1) {
      lines.splice(heading, 1, lines[heading] ?? '', '', bullet);
    } else {
      lines.splice(heading + 1 + last + 1, 0, bullet);
    }

    return lines.join(eol);
  }
}

export class WorkspaceDocs {
  static renderLibConcept(opts: {
    name: string;
    path: string;
    summary: string;
    presetPackage: string;
    /** Which preset kind made the package; `lib` when absent. */
    kind?: TLibraryType;
  }): string {
    return [
      '---',
      'type: Package',
      `title: ${opts.name}`,
      `description: ${JSON.stringify(opts.summary)}`,
      `resource: ${opts.path}`,
      'tags: [packages, library]',
      '---',
      '',
      `# ${opts.name}`,
      '',
      `The ${opts.kind === LibraryTypes.SHARED ? 'side-neutral package' : 'library'} at \`${opts.path}\`, created from the ${opts.presetPackage} preset (${opts.kind ?? LibraryTypes.LIB} kind). ${oneLine({ text: opts.summary })}`,
      '',
      ...renderAtlasLookups({ kind: PackageTypes.LIB }),
    ].join('\n');
  }

  /**
   * The config of a new monorepo as `vulcan project init` writes it: the config that composes the seven groups, one module per group in
   * `.configs/vulcan/`, and the apps block (`vulcan package add` rewrites it) in `project.mts`, exported for `knowledge.mts`.
   */
  static renderSplitConfig(opts: {
    project: string;
    key: string;
    block: IAppsBlock;
  }): { path: string; content: string }[] {
    const head = "import type { VulcanConfig } from '@venizia/vulcan';\n\n";
    const empty = (group: string, type: string): string =>
      `${head}export const ${group} = {} satisfies ${type};\n`;

    return [
      {
        path: '.configs/vulcan.config.mts',
        content:
          "import type { VulcanConfig } from '@venizia/vulcan';\nimport { agent, board, check, common, guard, knowledge, project } from './vulcan/index.mts';\n\nexport default {\n  project,\n  agent,\n  guard,\n  board,\n  knowledge,\n  check,\n  common,\n} satisfies VulcanConfig;\n",
      },
      {
        path: '.configs/vulcan/index.mts',
        content:
          "export { project } from './project.mts';\nexport { agent } from './agent.mts';\nexport { guard } from './guard.mts';\nexport { board } from './board.mts';\nexport { knowledge } from './knowledge.mts';\nexport { check } from './check.mts';\nexport { common } from './common.mts';\n",
      },
      {
        path: '.configs/vulcan/project.mts',
        content: [
          "import type { VulcanConfig } from '@venizia/vulcan';",
          '',
          AppsBlock.render({ block: opts.block, isExported: true }),
          '',
          'export const project = {',
          `  name: '${opts.project}',`,
          `  key: '${opts.key}',`,
          '  layout: apps.layout,',
          '  packages: apps.packages,',
          '  presets: apps.presets,',
          '} satisfies VulcanConfig.Project;',
          '',
        ].join('\n'),
      },
      {
        path: '.configs/vulcan/agent.mts',
        content: `${head}export const agent = {\n  rules: { 'V-W-01': 'on-user-word' },\n} satisfies VulcanConfig.Agent;\n`,
      },
      {
        path: '.configs/vulcan/knowledge.mts',
        content: `${head.replace('\n\n', "\nimport { apps } from './project.mts';\n\n")}export const knowledge = {\n  atlas: { sources: apps.sources },\n} satisfies VulcanConfig.Knowledge;\n`,
      },
      {
        path: '.configs/vulcan/guard.mts',
        content: empty('guard', 'NonNullable<VulcanConfig.Guard>'),
      },
      { path: '.configs/vulcan/board.mts', content: empty('board', 'VulcanConfig.Board') },
      { path: '.configs/vulcan/check.mts', content: empty('check', 'VulcanConfig.Check') },
      { path: '.configs/vulcan/common.mts', content: empty('common', 'VulcanConfig.Common') },
    ];
  }

  /** The catalog entry a `file:` preset writes only works on this machine; say so. */
  static filePresetWarning(opts: { spec: IPresetSpec; packageName: string }): string | undefined {
    return opts.spec.packageName === undefined
      ? `warning: the catalog gets ${opts.packageName} as ${opts.spec.range} - a file: entry is not portable, so a clone elsewhere or CI cannot install it until it names a published version`
      : undefined;
  }

  static renderKnowledgeIndex(opts: {
    project: string;
    apps: { name: string; summary: string }[];
  }): string {
    return [
      '---',
      'okf_version: "0.2"',
      '---',
      '',
      `# ${opts.project} knowledge`,
      '',
      `Facts about ${opts.project}, in the Open Knowledge Format. Rules live in \`../rules.md\`.`,
      '',
      '## Apps',
      '',
      ...opts.apps.map((app) => renderAppBullet({ app })),
      '',
    ].join('\n');
  }

  static renderAppConcept(opts: { app: IApp; summary: string; presetPackage: string }): string {
    return [
      '---',
      'type: Package',
      `title: ${opts.app.name}`,
      // JSON string syntax is valid YAML, so a colon, quote or newline in the summary stays one scalar.
      `description: ${JSON.stringify(opts.summary)}`,
      `resource: ${opts.app.folder}/${opts.app.name}`,
      `tags: [packages, ${opts.app.side}]`,
      '---',
      '',
      `# ${opts.app.name}`,
      '',
      `The ${opts.app.side} app at \`${opts.app.folder}/${opts.app.name}\`, created from the ${opts.presetPackage} preset. ${oneLine({ text: opts.summary })}`,
      '',
      ...renderAtlasLookups({ kind: opts.app.side }),
    ].join('\n');
  }
}

type TAppsBlockResult = { ok: true; block: IAppsBlock } | { ok: false; reason: TAppsBlockProblem };
