import { coversFolder } from '../init/index.ts';
import { CreateConstants } from './common/index.ts';
import type { IApp, IAppsBlock, IPreset, IPresetSpec } from './common/index.ts';

const ENV_PORT = /^[A-Z0-9_]*PORT=(\d+)\s*$/m;

/** A newline inside a list item or a paragraph would split it. */
const oneLine = (opts: { text: string }): string => opts.text.replace(/\s+/g, ' ').trim();

const json = (opts: { value: unknown }): string => `${JSON.stringify(opts.value, null, 2)}\n`;

export const renderRootManifest = (opts: {
  project: string;
  workspaces: string[];
  catalog: Record<string, string>;
  vulcanVersion: string;
}): string =>
  json({
    value: {
      name: opts.project,
      private: true,
      workspaces: { packages: opts.workspaces, catalog: opts.catalog },
      scripts: { dev: "bun run --filter '*' dev" },
      devDependencies: { '@venizia/vulcan': opts.vulcanVersion },
    },
  });

/** A version the monorepo already pins wins, so every app shares one copy. */
export const mergeCatalog = (opts: {
  catalog: Record<string, string>;
  additions: Record<string, string>;
}): Record<string, string> => ({ ...opts.additions, ...opts.catalog });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toStringRecord = (opts: { value: unknown }): Record<string, string> =>
  isRecord(opts.value)
    ? Object.fromEntries(
        Object.entries(opts.value).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      )
    : {};

/** The catalog of a root manifest wherever it lives: top level, or inside object-form workspaces. */
export const readCatalog = (opts: {
  manifest: Record<string, unknown>;
}): Record<string, string> => ({
  ...(isRecord(opts.manifest.workspaces)
    ? toStringRecord({ value: opts.manifest.workspaces.catalog })
    : {}),
  ...toStringRecord({ value: opts.manifest.catalog }),
});

/**
 * The root manifest with the new folder and the preset's catalog entries added, and nothing else
 * changed: an array of workspaces stays an array, and the catalog stays where the project keeps it
 * (top level, or inside object-form workspaces; an array has no room for one, so top level).
 */
export const planRootManifest = (opts: {
  manifest: Record<string, unknown>;
  globs: string[];
  folder: string;
  additions: Record<string, string>;
}): Record<string, unknown> => {
  const { manifest, folder } = opts;
  const { workspaces } = manifest;
  const globs = coversFolder({ globs: opts.globs, folder })
    ? opts.globs
    : [...opts.globs, `${folder}/*`];
  const existing = readCatalog({ manifest });
  const fresh = Object.fromEntries(
    Object.entries(opts.additions).filter(([name]) => existing[name] === undefined),
  );
  const isTopLevel = isRecord(manifest.catalog) || Array.isArray(workspaces);

  if (isTopLevel) {
    return {
      ...manifest,
      workspaces: Array.isArray(workspaces)
        ? globs
        : { ...(isRecord(workspaces) ? workspaces : {}), packages: globs },
      catalog: mergeCatalog({
        catalog: toStringRecord({ value: manifest.catalog }),
        additions: fresh,
      }),
    };
  }

  const inside = isRecord(workspaces) ? workspaces : {};

  return {
    ...manifest,
    workspaces: {
      ...inside,
      packages: globs,
      catalog: mergeCatalog({
        catalog: toStringRecord({ value: inside.catalog }),
        additions: fresh,
      }),
    },
  };
};

/**
 * The catalog value is read as the version the install resolves to, compared with the preset's
 * range by semver order (what Bun.semver implements). A prerelease sorts before its release, so
 * `^0.2.2-5` does not meet `^0.2.2`: it is refused, never rounded up. A value that is not a plain
 * version (`workspace:*`, a git URL, a range) cannot be compared, so it is refused as well.
 */
export const checkPeers = (opts: {
  catalog: Record<string, string>;
  peers: Record<string, string>;
}): string | undefined => {
  for (const [name, range] of Object.entries(opts.peers)) {
    const pinned = opts.catalog[name];

    if (pinned === undefined) {
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
};

const toCatalog = (opts: { dependencies: Record<string, string> }): Record<string, string> =>
  Object.fromEntries(
    Object.keys(opts.dependencies)
      .sort()
      .map(name => [name, 'catalog:']),
  );

export const renderAppManifest = (opts: {
  app: string;
  preset: IPreset;
  presetPackage: { name: string; version: string };
}): string =>
  json({
    value: {
      name: opts.app,
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

export const renderAppsBlock = (opts: { block: IAppsBlock }): string =>
  [
    CreateConstants.APPS_BLOCK_START,
    `const apps = ${JSON.stringify(opts.block, null, 2)};`,
    CreateConstants.APPS_BLOCK_END,
  ].join('\n');

export const renderVulcanConfig = (opts: { project: string; block: IAppsBlock }): string =>
  [
    "import type { VulcanConfig } from '@venizia/vulcan';",
    '',
    renderAppsBlock({ block: opts.block }),
    '',
    'export default {',
    `  name: '${opts.project}',`,
    "  agents: ['claude'],",
    "  rules: { 'V-W-01': 'on-user-word' },",
    '  layout: apps.layout,',
    '  packages: apps.packages,',
    '  atlas: { sources: apps.sources },',
    '} satisfies VulcanConfig;',
    '',
  ].join('\n');

/** Only the text between the markers is rewritten; undefined when the user edited them away. */
export const replaceAppsBlock = (opts: {
  source: string;
  block: IAppsBlock;
}): string | undefined => {
  const start = opts.source.indexOf(CreateConstants.APPS_BLOCK_START);
  const end = opts.source.indexOf(CreateConstants.APPS_BLOCK_END);

  if (start === -1 || end === -1 || end < start) {
    return undefined;
  }

  const before = opts.source.slice(0, start);
  const after = opts.source.slice(end + CreateConstants.APPS_BLOCK_END.length);

  return `${before}${renderAppsBlock({ block: opts.block })}${after}`;
};

const hasStrings = (opts: { value: unknown; keys: string[] }): boolean => {
  const { value } = opts;

  return isRecord(value) && opts.keys.every(key => typeof value[key] === 'string');
};

const isAppsBlock = (value: unknown): value is IAppsBlock =>
  isRecord(value) &&
  isRecord(value.layout) &&
  Object.values(value.layout).every(folder => typeof folder === 'string') &&
  Array.isArray(value.packages) &&
  value.packages.every(entry => hasStrings({ value: entry, keys: ['dir', 'name', 'path'] })) &&
  Array.isArray(value.sources) &&
  value.sources.every(entry => hasStrings({ value: entry, keys: ['name', 'repo', 'ref'] }));

export type TAppsBlockResult =
  | { ok: true; block: IAppsBlock }
  | { ok: false; reason: 'missing' | 'invalid' };

const APPS_DECLARATION = 'const apps = ';

/** What the markers hold now, so `add` extends it instead of rebuilding it from the resolved config. */
export const parseAppsBlock = (opts: { source: string }): TAppsBlockResult => {
  const start = opts.source.indexOf(CreateConstants.APPS_BLOCK_START);
  const end = opts.source.indexOf(CreateConstants.APPS_BLOCK_END);

  if (start === -1 || end === -1 || end < start) {
    return { ok: false, reason: 'missing' };
  }

  const body = opts.source.slice(start + CreateConstants.APPS_BLOCK_START.length, end);
  const declaration = body.indexOf(APPS_DECLARATION);

  if (declaration === -1) {
    return { ok: false, reason: 'invalid' };
  }

  try {
    const parsed: unknown = JSON.parse(
      body
        .slice(declaration + APPS_DECLARATION.length)
        .trim()
        .replace(/;$/, ''),
    );

    return isAppsBlock(parsed) ? { ok: true, block: parsed } : { ok: false, reason: 'invalid' };
  } catch (error) {
    console.error(
      `[parseAppsBlock] the vulcan:apps block is not JSON | ${error instanceof Error ? error.message : String(error)}`,
    );

    return { ok: false, reason: 'invalid' };
  }
};

const APPS_HEADING = /^## Apps\s*$/;
const ANY_HEADING = /^#{1,2}\s/;

const renderAppBullet = (opts: { app: { name: string; summary: string } }): string =>
  `- [${opts.app.name}](packages/${opts.app.name}.md) - ${oneLine({ text: opts.app.summary })}`;

/**
 * One bullet for one app, after the last bullet under `## Apps` (a section is added when the index
 * has none). Every other byte of the index is the user's and is returned as it was.
 */
export const addAppBullet = (opts: {
  source: string;
  app: { name: string; summary: string };
}): string => {
  if (opts.source.includes(`](packages/${opts.app.name}.md)`)) {
    return opts.source;
  }

  const eol = opts.source.includes('\r\n') ? '\r\n' : '\n';
  const bullet = renderAppBullet({ app: opts.app });
  const lines = opts.source.split(eol);
  const heading = lines.findIndex(line => APPS_HEADING.test(line));

  if (heading === -1) {
    const kept = opts.source.trimEnd();

    return `${kept === '' ? '' : `${kept}${eol}${eol}`}## Apps${eol}${eol}${bullet}${eol}`;
  }

  const next = lines.findIndex((line, index) => index > heading && ANY_HEADING.test(line));
  const section = lines.slice(heading + 1, next === -1 ? lines.length : next);
  const last = section.findLastIndex(line => line.startsWith('- ['));

  if (last === -1) {
    lines.splice(heading, 1, lines[heading] ?? '', '', bullet);
  } else {
    lines.splice(heading + 1 + last + 1, 0, bullet);
  }

  return lines.join(eol);
};

/** The catalog entry a `file:` preset writes only works on this machine; say so. */
export const filePresetWarning = (opts: {
  spec: IPresetSpec;
  packageName: string;
}): string | undefined =>
  opts.spec.packageName === undefined
    ? `warning: the catalog gets ${opts.packageName} as ${opts.spec.range} - a file: entry is not portable, so a clone elsewhere or CI cannot install it until it names a published version`
    : undefined;

export const renderKnowledgeIndex = (opts: {
  project: string;
  apps: { name: string; summary: string }[];
}): string =>
  [
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
    ...opts.apps.map(app => renderAppBullet({ app })),
    '',
  ].join('\n');

export const renderAppConcept = (opts: {
  app: IApp;
  summary: string;
  presetPackage: string;
}): string =>
  [
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
  ].join('\n');

export const renderLogEntry = (opts: { date: string; text: string }): string =>
  `## ${opts.date}\n\n- ${opts.text}\n`;

export const pickPort = (opts: { preferred: number; used: number[] }): number => {
  let port = opts.preferred;

  while (opts.used.includes(port)) {
    port++;
  }

  return port;
};

export const readPort = (opts: { envExample: string }): number | undefined => {
  const match = ENV_PORT.exec(opts.envExample);

  return match === null ? undefined : Number(match[1]);
};
