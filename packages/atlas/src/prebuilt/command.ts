import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { ModeUsageError, readRootArgument } from '@/cli/modes';
import { buildIndexPair } from './build';
import { PrebuiltConstants } from './constants';
import { generateKeyPair } from './keys';

/** A flag's value, in both spellings (`--out dir`, `--out=dir`); `undefined` when absent. */
const flagValue = (opts: { argv: string[]; name: string }): string | undefined => {
  const joined = opts.argv.find((argument) => argument.startsWith(`${opts.name}=`));

  if (joined !== undefined) {
    return joined.slice(opts.name.length + 1);
  }

  const index = opts.argv.indexOf(opts.name);

  if (index === -1) {
    return undefined;
  }

  const value = opts.argv[index + 1];

  if (value === undefined || value.startsWith('--')) {
    throw new ModeUsageError(`${opts.name} requires a value`);
  }

  return value;
};

/**
 * A key pair for a repository's index: the private key into `.agents/local/` (mode 0600, only while
 * that folder is gitignored, never over an existing key) and the public key printed.
 */
export const runKeygen = (opts: {
  root: string;
  print: (line: string) => void;
}): { file: string; publicKey: string } => {
  const file = join(opts.root, PrebuiltConstants.KEY_FILE);
  const ignored =
    spawnSync('git', ['check-ignore', '-q', PrebuiltConstants.KEY_FILE], { cwd: opts.root })
      .status === 0;

  if (!ignored) {
    throw new Error(
      `atlas index keygen: ${PrebuiltConstants.KEY_FILE} is not covered by .gitignore here (or ${opts.root} is not a git repository): a private key must never be committable`,
    );
  }

  if (existsSync(file)) {
    throw new Error(`atlas index keygen: ${file} already exists - it is never overwritten`);
  }

  const pair = generateKeyPair();

  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${pair.privateKey}\n`, { mode: 0o600, flag: 'wx' });

  const shown = relative(opts.root, file);

  opts.print(`private key: ${shown} (mode 0600, stays on this machine)`);
  opts.print(
    `store it as the Actions secret: gh secret set ${PrebuiltConstants.KEY_ENV} < ${shown}`,
  );
  opts.print(`then remove the file: rm ${shown}`);
  opts.print(`public key, for atlas.index.keys in the vulcan config: ${pair.publicKey}`);

  return { file, publicKey: pair.publicKey };
};

/** `index --out <dir> [--key-env <name>] [--repo <owner/name>] [--root <dir>]`, or `index keygen`. */
export const runIndexCommand = (opts: { argv: string[]; version: string }): number => {
  const root = readRootArgument({ argv: opts.argv }).value;

  if (opts.argv[1] === 'keygen') {
    runKeygen({ root, print: (line) => console.log(line) });

    return 0;
  }

  const out = flagValue({ argv: opts.argv, name: '--out' });

  if (out === undefined) {
    throw new ModeUsageError('index requires --out <dir>');
  }

  const keyEnv = flagValue({ argv: opts.argv, name: '--key-env' }) ?? PrebuiltConstants.KEY_ENV;
  const built = buildIndexPair({
    root,
    out,
    repo: flagValue({ argv: opts.argv, name: '--repo' }),
    privateKey: process.env[keyEnv],
    atlasVersion: opts.version,
  });

  console.log(
    `index: ${built.sha.slice(0, 8)} -> ${relative(root, built.gz)}, ${relative(root, built.envelope)}`,
  );

  return 0;
};
