import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readAtlasPackages } from '@/common/project-config';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const createProject = (opts: { file: string; text: string }): string => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-config-'));
  roots.push(root);
  mkdirSync(join(root, '.configs'), { recursive: true });
  writeFileSync(join(root, '.configs', opts.file), opts.text);
  return root;
};

test('the package directories come from atlas.packages, in the order given', () => {
  const root = createProject({
    file: 'vulcan.config.ts',
    text: "export default { atlas: { packages: { kernel: '@a/kernel', admin: '@a/admin', ardor: '@a/ardor' } } };\n",
  });

  expect(readAtlasPackages({ repoRoot: root })).toEqual(['kernel', 'admin', 'ardor']);
});

test('an .mjs config reads the same', () => {
  const root = createProject({
    file: 'vulcan.config.mjs',
    text: "export default { atlas: { packages: { one: '@a/one' } } };\n",
  });

  expect(readAtlasPackages({ repoRoot: root })).toEqual(['one']);
});

test('no atlas.packages stops with what to add', () => {
  const root = createProject({
    file: 'vulcan.config.ts',
    text: "export default { agents: ['claude'] };\n",
  });

  expect(() => readAtlasPackages({ repoRoot: root })).toThrow(
    '[atlas] add atlas.packages to .configs/vulcan.config.ts - the package directories under packages/, in release order',
  );
});

test('no config at all stops with what to add', () => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-config-'));
  roots.push(root);

  expect(() => readAtlasPackages({ repoRoot: root })).toThrow(
    '[atlas] no .configs/vulcan.config.* in ' + root,
  );
});
