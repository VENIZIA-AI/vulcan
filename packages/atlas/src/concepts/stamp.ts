import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { formatWithBun } from '@/common/format';
import type { IAtlasProject } from '@/common/project-config';
import { parseFrontmatter } from '@/corpus/frontmatter';
import { symbolsOfRepository } from '@/symbols/compute';
import type { ISymbolRecord } from '@/symbols/common';
import { ConceptProblems, SYMBOLS_LOCK_NAME } from './common';
import type { IConceptProblem, IDeclaredSymbol, IStampReport } from './common';

/** The lock layout this atlas reads and writes (V2); another one fails loudly. 2 hashes the whole declaration. */
const LOCK_SCHEMA_VERSION = 2;
const HASH_LENGTH = 8;

export interface ISymbolsLock {
  schemaVersion: number;
  /** `<npm name>#<Symbol>` to its signature hash. */
  symbols: Record<string, string>;
}

const byText = (left: string, right: string): number => {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
};

/** The lock's path inside the knowledge bundle. */
export const symbolsLockOf = (opts: { project: IAtlasProject }): string =>
  join(opts.project.knowledge.bundle, SYMBOLS_LOCK_NAME);

/** Every `symbols:` entry of every concept in the bundle, in path order; a concept without one has none. */
export const readDeclaredSymbols = (opts: { project: IAtlasProject }): IDeclaredSymbol[] => {
  const { bundle } = opts.project.knowledge;

  if (!existsSync(bundle)) {
    return [];
  }

  const paths = [...new Bun.Glob('**/*.md').scanSync({ cwd: bundle })].sort(byText);

  return paths.flatMap(path => {
    const { data } = parseFrontmatter({
      text: readFileSync(join(bundle, path), 'utf8'),
      path,
    });
    const declared: unknown[] = Array.isArray(data.symbols) ? data.symbols : [];
    const concept = relative(opts.project.root, join(bundle, path));

    return declared.map(symbol => ({ concept, symbol: String(symbol) }));
  });
};

/** The package and the symbol of `<npm name>#<Symbol>`, when it names a package the manifest declares. */
const splitDeclaration = (opts: {
  symbol: string;
  project: IAtlasProject;
}): { packageName: string; name: string } | undefined => {
  const at = opts.symbol.lastIndexOf('#');
  const packageName = opts.symbol.slice(0, at);
  const name = opts.symbol.slice(at + 1);

  return at > 0 &&
    name.length > 0 &&
    opts.project.packages.some(entry => entry.name === packageName)
    ? { packageName, name }
    : undefined;
};

/**
 * The signature hash of one declaration among the built records, or why it has none. A symbol
 * exported from several subpaths hashes every signature it has.
 */
export const resolveDeclaredSymbol = (opts: {
  symbol: string;
  project: IAtlasProject;
  records: ISymbolRecord[];
}):
  | { hash: string }
  | { problem: typeof ConceptProblems.MISSING | typeof ConceptProblems.MALFORMED } => {
  const declaration = splitDeclaration(opts);

  if (declaration === undefined) {
    return { problem: ConceptProblems.MALFORMED };
  }

  const signatures = opts.records
    .filter(
      record => record.package === declaration.packageName && record.name === declaration.name,
    )
    .map(record => `${record.signature}\n${record.shape ?? ''}`);

  if (signatures.length === 0) {
    return { problem: ConceptProblems.MISSING };
  }

  const hash = new Bun.CryptoHasher('sha256')
    .update([...new Set(signatures)].sort(byText).join('\n'))
    .digest('hex');

  return { hash: hash.slice(0, HASH_LENGTH) };
};

/** The committed lock, or `undefined` before the first stamp. */
export const readSymbolsLock = (opts: { project: IAtlasProject }): ISymbolsLock | undefined => {
  const file = symbolsLockOf(opts);

  if (!existsSync(file)) {
    return undefined;
  }

  const lock: ISymbolsLock = JSON.parse(readFileSync(file, 'utf8'));

  if (lock.schemaVersion < LOCK_SCHEMA_VERSION) {
    throw new Error(
      `atlas: ${SYMBOLS_LOCK_NAME} is schemaVersion ${String(lock.schemaVersion)}, which hashed one signature line; run \`vulcan x atlas concepts stamp\` to lock the whole declaration (schemaVersion ${LOCK_SCHEMA_VERSION})`,
    );
  }

  if (lock.schemaVersion !== LOCK_SCHEMA_VERSION) {
    throw new Error(
      `atlas: ${SYMBOLS_LOCK_NAME} is schemaVersion ${String(lock.schemaVersion)}; @venizia/vulcan-atlas reads ${LOCK_SCHEMA_VERSION} - upgrade @venizia/vulcan`,
    );
  }

  return lock;
};

/**
 * Project Contract v1, V4: writes the lock - each symbol a concept declares, with its signature
 * hash read from the built `.d.ts`. A declaration that resolves to nothing stops it, unwritten.
 */
export const stampConcepts = (opts: { project: IAtlasProject }): IStampReport => {
  const { project } = opts;
  const declared = readDeclaredSymbols({ project });
  const records = declared.length === 0 ? [] : symbolsOfRepository({ project });
  const hashes = new Map<string, string>();
  const missing: IConceptProblem[] = [];
  const lockFile = relative(project.root, symbolsLockOf({ project }));

  for (const entry of declared) {
    const resolved = resolveDeclaredSymbol({ symbol: entry.symbol, project, records });

    if ('problem' in resolved) {
      missing.push({ ...entry, problem: resolved.problem });
      continue;
    }

    hashes.set(entry.symbol, resolved.hash);
  }

  if (missing.length > 0) {
    return { lockFile, stamped: 0, missing };
  }

  const lock: ISymbolsLock = {
    schemaVersion: LOCK_SCHEMA_VERSION,
    symbols: Object.fromEntries([...hashes].sort(([left], [right]) => byText(left, right))),
  };

  writeFileSync(
    symbolsLockOf({ project }),
    formatWithBun({ text: `${JSON.stringify(lock, null, 2)}\n`, file: SYMBOLS_LOCK_NAME }),
  );

  return { lockFile, stamped: hashes.size, missing };
};
