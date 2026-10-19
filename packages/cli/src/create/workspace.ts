import { CreateConstants } from './common/index.ts';
import type { IApp, IAppsBlock, IPreset } from './common/index.ts';

const ENV_PORT = /^[A-Z0-9_]*PORT=(\d+)\s*$/m;

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

export const checkPeers = (opts: {
  catalog: Record<string, string>;
  peers: Record<string, string>;
}): string | undefined => {
  for (const [name, range] of Object.entries(opts.peers)) {
    const pinned = opts.catalog[name];

    if (pinned !== undefined && !Bun.semver.satisfies(pinned.replace(/^[\^~]/, ''), range)) {
      return `the monorepo pins ${name} ${pinned}, but the preset needs ${range} - move the catalog first`;
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
      scripts: opts.preset.scripts,
      dependencies: toCatalog({
        dependencies: {
          ...opts.preset.dependencies,
          [opts.presetPackage.name]: opts.presetPackage.version,
        },
      }),
      devDependencies: toCatalog({ dependencies: opts.preset.devDependencies }),
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
    ...opts.apps.map(app => `- [${app.name}](packages/${app.name}.md) - ${app.summary}`),
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
    `description: ${opts.summary}`,
    `resource: ${opts.app.folder}/${opts.app.name}`,
    `tags: [packages, ${opts.app.side}]`,
    '---',
    '',
    `# ${opts.app.name}`,
    '',
    `The ${opts.app.side} app at \`${opts.app.folder}/${opts.app.name}\`, created from the ${opts.presetPackage} preset. ${opts.summary}`,
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
