/**
 * Guards dependency versions against the root `workspaces.catalog`.
 *
 * A catalogued dependency is referenced as `catalog:` and resolved while packing by `bun publish`.
 * `npm publish` ships `catalog:` verbatim and every consumer's install breaks, so the catalog is the
 * one place a catalogued version lives.
 */
import { Glob } from 'bun';
import { join } from 'node:path';

type TDependencies = Record<string, string>;

interface IManifest {
  workspaces?: { catalog?: TDependencies };
  dependencies?: TDependencies;
  devDependencies?: TDependencies;
  peerDependencies?: TDependencies;
}

/** The root and every workspace member. */
const MANIFEST_GLOBS = ['package.json', 'packages/*/package.json'];

/** `peerDependencies` are compatibility statements for consumers, deliberately looser than the install range. */
const CATALOGUED_BLOCKS = ['dependencies', 'devDependencies'] as const;

export const findCatalogProblems = async (opts: { root: string }): Promise<string[]> => {
  const rootManifest: IManifest = await Bun.file(join(opts.root, 'package.json')).json();
  const catalog = rootManifest.workspaces?.catalog ?? {};

  if (Object.keys(catalog).length === 0) {
    return ['package.json: no `workspaces.catalog`'];
  }

  const problems: string[] = [];
  const referenced = new Set<string>();
  const files = MANIFEST_GLOBS.flatMap((pattern) => [
    ...new Glob(pattern).scanSync(opts.root),
  ]).sort();

  for (const file of files) {
    const manifest: IManifest = await Bun.file(join(opts.root, file)).json();

    for (const block of CATALOGUED_BLOCKS) {
      for (const [name, range] of Object.entries(manifest[block] ?? {})) {
        if (!(name in catalog)) {
          continue;
        }

        referenced.add(name);

        if (range !== 'catalog:') {
          problems.push(
            `${file}: ${block}.${name} is "${range}" but the catalog owns it - use "catalog:" (catalog pins ${catalog[name]})`,
          );
        }
      }
    }

    // A peer resolved from the catalog collapses to the exact install range and stops being a peer.
    for (const [name, range] of Object.entries(manifest.peerDependencies ?? {})) {
      if (range === 'catalog:') {
        problems.push(
          `${file}: peerDependencies.${name} uses "catalog:" - a peer range must stay hand-authored and looser than the install range`,
        );
      }
    }
  }

  // An entry nobody references drifts out of date unnoticed.
  for (const name of Object.keys(catalog).filter((entry) => !referenced.has(entry))) {
    problems.push(`package.json: catalog entry "${name}" is referenced by no workspace - drop it`);
  }

  return problems;
};

if (import.meta.main) {
  const problems = await findCatalogProblems({ root: process.cwd() });

  if (problems.length > 0) {
    console.error(`check-catalog: ${problems.length} problem(s):`);

    for (const problem of problems) {
      console.error(`  ${problem}`);
    }

    process.exit(1);
  }

  console.log('check-catalog: OK');
}
