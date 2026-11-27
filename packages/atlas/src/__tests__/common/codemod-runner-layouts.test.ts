import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { CodemodRunner } from '@/common/codemod-runner';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

interface IInstall {
  root: string;
  name: string;
  bin: string;
}

const app = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-runner-layout-'));

  roots.push(root);
  mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true });

  return root;
};

const file = (path: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, '#!/usr/bin/env bun\n');
};

/** The hoisted layout: `node_modules/<name>` is the package, `.bin/<bin>` links into it. */
const hoisted = (opts: IInstall): void => {
  file(join(opts.root, 'node_modules', opts.name, 'src', 'cli.ts'));
  symlinkSync(
    join('..', opts.name, 'src', 'cli.ts'),
    join(opts.root, 'node_modules', '.bin', opts.bin),
  );
};

/** Bun's isolated layout: the package is in `.bun/<name>@<v>/node_modules/<name>`, `node_modules/<name>` is a link to it. */
const isolated = (opts: IInstall): void => {
  const store = join(opts.root, 'node_modules', '.bun', `${opts.name.replace('/', '+')}@1.0.0`);

  file(join(store, 'node_modules', opts.name, 'src', 'cli.ts'));
  mkdirSync(dirname(join(opts.root, 'node_modules', opts.name)), { recursive: true });
  symlinkSync(join(store, 'node_modules', opts.name), join(opts.root, 'node_modules', opts.name));
  symlinkSync(
    join('..', opts.name, 'src', 'cli.ts'),
    join(opts.root, 'node_modules', '.bin', opts.bin),
  );
};

describe.each([
  ['hoisted', hoisted],
  ['Bun isolated', isolated],
])('the codemod runner trust check, %s layout', (_label, install) => {
  test('a bin inside an installed package of the source is allowed', () => {
    const root = app();

    install({ root, name: '@venizia/dev-configs', bin: 'devz' });

    expect(
      CodemodRunner.refusalOf({
        directory: root,
        name: 'devz',
        packages: ['@venizia/dev-configs'],
      }),
    ).toBeUndefined();
  });

  test('the bin of VULCAN is refused for a source that does not declare it, allowed when the packages name it', () => {
    const root = app();

    install({ root, name: '@venizia/vulcan', bin: 'vulcan' });

    expect(
      CodemodRunner.refusalOf({ directory: root, name: 'vulcan', packages: ['@acme/kernel'] }),
    ).toContain('not inside an installed package');
    expect(
      CodemodRunner.refusalOf({
        directory: root,
        name: 'vulcan',
        packages: ['@acme/kernel', CodemodRunner.TOOL_PACKAGE],
      }),
    ).toBeUndefined();
  });

  test('a bin of another package is refused', () => {
    const root = app();

    install({ root, name: 'rimraf', bin: 'rimraf' });

    expect(
      CodemodRunner.refusalOf({
        directory: root,
        name: 'rimraf',
        packages: ['@venizia/dev-configs'],
      }),
    ).toContain('not inside an installed package');
  });

  test('a bin that leaves the package through a link is refused', () => {
    const root = app();
    const outside = join(root, 'elsewhere', 'evil.ts');

    install({ root, name: '@venizia/vulcan', bin: 'vulcan' });
    file(outside);
    rmSync(join(root, 'node_modules', '.bin', 'vulcan'));
    symlinkSync(outside, join(root, 'node_modules', '.bin', 'vulcan'));

    expect(
      CodemodRunner.refusalOf({ directory: root, name: 'vulcan', packages: ['@venizia/vulcan'] }),
    ).toContain('not inside an installed package');
  });
});
