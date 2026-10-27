import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runKeygen, signEnvelope, verifyPair } from '@/prebuilt';
import type { IIndexPayload } from '@/prebuilt';
import { gzipSync } from 'node:zlib';
import { git, makeTempDirectory, TEMP_DIRECTORIES } from '../sources/source-repo.helper';

afterAll(() => {
  for (const directory of TEMP_DIRECTORIES) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const repository = (opts: { ignoresLocal: boolean }): string => {
  const root = makeTempDirectory({ prefix: 'atlas-keygen-' });

  git({ cwd: root, args: ['init', '-q', '-b', 'develop'] });

  if (opts.ignoresLocal) {
    writeFileSync(join(root, '.gitignore'), '.agents/local/\n');
  }

  return root;
};

describe('atlas index keygen (C9)', () => {
  test('the private key lands under .agents/local with mode 0600, and only the public key is printed', () => {
    const root = repository({ ignoresLocal: true });
    const printed: string[] = [];
    const result = runKeygen({ root, print: (line) => printed.push(line) });
    const file = join(root, '.agents/local/atlas-index.key');

    expect(result.file).toBe(file);
    expect(statSync(file).mode & 0o777).toBe(0o600);

    const privateKey = readFileSync(file, 'utf8').trim();
    const text = printed.join('\n');

    expect(text).toContain(result.publicKey);
    expect(text).not.toContain(privateKey);

    // The two halves belong together: what the file signs, the printed key verifies.
    const gz = gzipSync(new TextEncoder().encode('x'));
    const payload: IIndexPayload = {
      format: 1,
      sha: 'b'.repeat(40),
      repo: 'acme/src',
      atlas: '0.4.6',
      builtAt: '2026-10-27T00:00:00.000Z',
      bytes: 1,
      digest: new Bun.CryptoHasher('sha256').update(gz).digest('hex'),
      tags: '',
      history: true,
      releases: { releases: {}, changelogs: [] },
    };

    expect(
      verifyPair({
        envelope: signEnvelope({ payload, privateKey }),
        gz,
        keys: [result.publicKey],
      }).ok,
    ).toBe(true);
  });

  test('it refuses while .agents/local is not gitignored, and writes nothing', () => {
    const root = repository({ ignoresLocal: false });

    expect(() => runKeygen({ root, print: () => undefined })).toThrow('gitignore');
    expect(existsSync(join(root, '.agents/local/atlas-index.key'))).toBe(false);
  });

  test('it refuses outside a git repository', () => {
    const root = makeTempDirectory({ prefix: 'atlas-keygen-nogit-' });

    expect(() => runKeygen({ root, print: () => undefined })).toThrow('gitignore');
    expect(existsSync(join(root, '.agents/local/atlas-index.key'))).toBe(false);
  });

  test('it never overwrites a key that is already there', () => {
    const root = repository({ ignoresLocal: true });

    runKeygen({ root, print: () => undefined });

    const before = readFileSync(join(root, '.agents/local/atlas-index.key'), 'utf8');

    expect(() => runKeygen({ root, print: () => undefined })).toThrow('already');
    expect(readFileSync(join(root, '.agents/local/atlas-index.key'), 'utf8')).toBe(before);
  });
});
