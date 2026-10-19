import { describe, expect, test } from 'bun:test';
import {
  checkPeers,
  mergeCatalog,
  pickPort,
  readPort,
  renderAppConcept,
  renderAppManifest,
  renderAppsBlock,
  renderKnowledgeIndex,
  renderLogEntry,
  renderRootManifest,
  renderVulcanConfig,
  replaceAppsBlock,
} from '../../create/workspace.ts';
import { parseYamlMapping, splitFrontmatter } from '@venizia/vulcan-okf';
import type { IAppsBlock, IPreset } from '../../create/index.ts';

const PRESET: IPreset = {
  presetVersion: 1,
  side: 'backend',
  summary: 'A fixture backend.',
  devPort: 3000,
  dependencies: { hono: '^4.13.13', '@venizia/widget-boot': '0.2.1' },
  devDependencies: { typescript: '^6.0.3' },
  peers: {},
  scripts: { dev: 'bun run src/index.ts' },
  checks: ['typecheck'],
  files: '/x',
  atlas: [],
};
const BLOCK: IAppsBlock = {
  layout: { backend: 'services', shared: 'libs' },
  packages: [{ dir: 'core-api', name: 'core-api', path: 'services/core-api' }],
  sources: [{ name: 'widget', repo: 'example/widget', ref: 'develop' }],
};

describe('workspace planners', () => {
  test('root manifest: private, workspaces, catalog, vulcan pinned exactly', () => {
    const manifest = JSON.parse(
      renderRootManifest({
        project: 'my-product',
        workspaces: ['services/*', 'libs/*'],
        catalog: { hono: '^4' },
        vulcanVersion: '0.3.0',
      }),
    );

    expect(manifest).toEqual({
      name: 'my-product',
      private: true,
      workspaces: { packages: ['services/*', 'libs/*'], catalog: { hono: '^4' } },
      scripts: { dev: "bun run --filter '*' dev" },
      devDependencies: { '@venizia/vulcan': '0.3.0' },
    });
  });

  test('mergeCatalog keeps an existing version', () => {
    expect(
      mergeCatalog({
        catalog: { '@venizia/widget': '0.2.2' },
        additions: { '@venizia/widget': '0.2.3', react: '^19' },
      }),
    ).toEqual({ '@venizia/widget': '0.2.2', react: '^19' });
  });

  test('checkPeers names both versions when the catalog is outside the range', () => {
    expect(
      checkPeers({
        catalog: { '@venizia/widget-kernel': '0.2.2' },
        peers: { '@venizia/widget-kernel': '^0.3.0' },
      }),
    ).toBe(
      'the monorepo pins @venizia/widget-kernel 0.2.2, but the preset needs ^0.3.0 - move the catalog first',
    );
    expect(
      checkPeers({
        catalog: { '@venizia/widget-kernel': '0.2.2' },
        peers: { '@venizia/widget-kernel': '^0.2.2' },
      }),
    ).toBeUndefined();
  });

  test('checkPeers reads a caret-pinned catalog entry and skips a peer the catalog lacks', () => {
    expect(
      checkPeers({ catalog: { kit: '^1.4.0' }, peers: { kit: '^1.0.0', other: '^9.0.0' } }),
    ).toBeUndefined();
  });

  test('app manifest uses catalog: for every dependency and pins the preset package', () => {
    const manifest = JSON.parse(
      renderAppManifest({
        app: 'core-api',
        preset: PRESET,
        presetPackage: { name: '@venizia/widget', version: '0.2.2' },
      }),
    );

    expect(manifest.name).toBe('core-api');
    expect(manifest.private).toBe(true);
    expect(manifest.dependencies).toEqual({
      '@venizia/widget': 'catalog:',
      '@venizia/widget-boot': 'catalog:',
      hono: 'catalog:',
    });
    expect(manifest.devDependencies).toEqual({ typescript: 'catalog:' });
    expect(manifest.scripts).toEqual({ dev: 'bun run src/index.ts' });
  });

  test('config block round-trips through replaceAppsBlock', () => {
    const source = renderVulcanConfig({ project: 'my-product', block: BLOCK });

    expect(source).toContain("name: 'my-product'");
    expect(source).toContain('satisfies VulcanConfig');

    const next = replaceAppsBlock({
      source,
      block: { ...BLOCK, layout: { ...BLOCK.layout, frontend: 'web' } },
    });

    expect(next).toContain('"frontend": "web"');
    expect(next?.split('vulcan:apps:start').length).toBe(2);
  });

  test('replaceAppsBlock keeps what the user wrote outside the markers', () => {
    const source = renderVulcanConfig({ project: 'my-product', block: BLOCK }).replace(
      "agents: ['claude']",
      "agents: ['claude', 'codex']",
    );
    const next = replaceAppsBlock({ source, block: { ...BLOCK, packages: [] } });

    expect(next).toContain("agents: ['claude', 'codex']");
    expect(next).toContain('"packages": []');
  });

  test('replaceAppsBlock returns undefined when the markers are gone', () => {
    expect(replaceAppsBlock({ source: 'export default {};\n', block: BLOCK })).toBeUndefined();
  });

  test('replaceAppsBlock returns undefined when the markers are swapped', () => {
    const source = renderVulcanConfig({ project: 'my-product', block: BLOCK });
    const swapped = source
      .replace('// vulcan:apps:end', '// TMP')
      .replace(/\/\/ vulcan:apps:start[^\n]*/, '// vulcan:apps:end')
      .replace('// TMP', '// vulcan:apps:start - moved');

    expect(replaceAppsBlock({ source: swapped, block: BLOCK })).toBeUndefined();
  });

  test('knowledge index links every app and has no scaffold marker', () => {
    const index = renderKnowledgeIndex({
      project: 'my-product',
      apps: [{ name: 'core-api', summary: 'A fixture backend.' }],
    });

    expect(index).toContain('okf_version: "0.2"');
    expect(index).toContain('[core-api](packages/core-api.md)');
    expect(index).not.toContain('vulcan:scaffold');
  });

  test('the app concept names its folder, side and preset package', () => {
    const concept = renderAppConcept({
      app: { name: 'core-api', side: 'backend', folder: 'services' },
      summary: 'A fixture backend.',
      presetPackage: '@venizia/widget',
    });

    expect(concept).toContain('type: Package');
    expect(concept).toContain('resource: services/core-api');
    expect(concept).toContain('tags: [packages, backend]');
    expect(concept).toContain('@venizia/widget');
  });

  test('a summary with a newline, a colon and quotes still gives frontmatter that parses', () => {
    const summary = 'Line one: a "quoted" part\nline two # not a comment, [brackets] & more';
    const concept = renderAppConcept({
      app: { name: 'core-api', side: 'backend', folder: 'services' },
      summary,
      presetPackage: '@venizia/widget',
    });
    const { yaml } = splitFrontmatter({ text: concept });
    const parsed = parseYamlMapping({ yaml: yaml ?? '' });

    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.data.description).toBe(summary);
    expect(parsed.ok && parsed.data.type).toBe('Package');
    expect(parsed.ok && parsed.data.resource).toBe('services/core-api');
    expect(parsed.ok && parsed.data.tags).toEqual(['packages', 'backend']);
  });

  test('a multi-line summary stays on one line in the knowledge index', () => {
    const index = renderKnowledgeIndex({
      project: 'my-product',
      apps: [{ name: 'core-api', summary: 'First line\nsecond line' }],
    });

    expect(index).toContain('- [core-api](packages/core-api.md) - First line second line');
  });

  test('a log entry is a dated heading with one bullet', () => {
    expect(renderLogEntry({ date: '2026-10-20', text: 'Added core-api.' })).toBe(
      '## 2026-10-20\n\n- Added core-api.\n',
    );
  });

  test('ports: the preferred one when free, the next free otherwise; read from .env.example', () => {
    expect(pickPort({ preferred: 3000, used: [] })).toBe(3000);
    expect(pickPort({ preferred: 3000, used: [3000, 3001] })).toBe(3002);
    expect(readPort({ envExample: 'X=1\nAPP_ENV_SERVER_PORT=3001\n' })).toBe(3001);
    expect(readPort({ envExample: 'X=1\n' })).toBeUndefined();
  });

  test('renderAppsBlock is valid JSON between the markers', () => {
    const block = renderAppsBlock({ block: BLOCK });
    const json = block
      .split('\n')
      .slice(1, -1)
      .join('\n')
      .replace(/^const apps = /, '')
      .replace(/;$/, '');

    expect(JSON.parse(json)).toEqual(BLOCK);
  });
});
