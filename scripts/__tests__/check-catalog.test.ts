import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findCatalogProblems } from '../check-catalog.ts';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const createWorkspace = (opts: { root: object; packages: Record<string, object> }): string => {
  const root = mkdtempSync(join(tmpdir(), 'check-catalog-'));
  roots.push(root);
  writeFileSync(join(root, 'package.json'), JSON.stringify(opts.root));

  for (const [name, manifest] of Object.entries(opts.packages)) {
    mkdirSync(join(root, 'packages', name), { recursive: true });
    writeFileSync(join(root, 'packages', name, 'package.json'), JSON.stringify(manifest));
  }

  return root;
};

const CATALOG_ROOT = {
  workspaces: { packages: ['packages/*'], catalog: { zod: '4.5.4', oxfmt: '0.1.0' } },
};

describe('findCatalogProblems', () => {
  test('every catalogued dependency referenced as catalog: is clean', async () => {
    const root = createWorkspace({
      root: { ...CATALOG_ROOT, devDependencies: { oxfmt: 'catalog:' } },
      packages: { cli: { dependencies: { zod: 'catalog:' } } },
    });

    expect(await findCatalogProblems({ root })).toEqual([]);
  });

  test('a catalogued dependency pinned by hand is a problem, in a package or at the root', async () => {
    const root = createWorkspace({
      root: { ...CATALOG_ROOT, devDependencies: { oxfmt: '0.1.0' } },
      packages: { cli: { dependencies: { zod: '4.5.4' } } },
    });

    expect(await findCatalogProblems({ root })).toEqual([
      'package.json: devDependencies.oxfmt is "0.1.0" but the catalog owns it - use "catalog:" (catalog pins 0.1.0)',
      'packages/cli/package.json: dependencies.zod is "4.5.4" but the catalog owns it - use "catalog:" (catalog pins 4.5.4)',
    ]);
  });

  test('a catalog entry nobody references is a problem', async () => {
    const root = createWorkspace({
      root: CATALOG_ROOT,
      packages: { cli: { dependencies: { zod: 'catalog:' } } },
    });

    expect(await findCatalogProblems({ root })).toEqual([
      'package.json: catalog entry "oxfmt" is referenced by no workspace - drop it',
    ]);
  });

  test('a peer dependency from the catalog is a problem: a peer range stays looser than the install range', async () => {
    const root = createWorkspace({
      root: { ...CATALOG_ROOT, devDependencies: { oxfmt: 'catalog:' } },
      packages: {
        cli: { dependencies: { zod: 'catalog:' }, peerDependencies: { zod: 'catalog:' } },
      },
    });

    expect(await findCatalogProblems({ root })).toEqual([
      'packages/cli/package.json: peerDependencies.zod uses "catalog:" - a peer range must stay hand-authored and looser than the install range',
    ]);
  });

  test('no catalog at all is a problem', async () => {
    const root = createWorkspace({
      root: { workspaces: { packages: ['packages/*'] } },
      packages: {},
    });

    expect(await findCatalogProblems({ root })).toEqual(['package.json: no `workspaces.catalog`']);
  });
});
