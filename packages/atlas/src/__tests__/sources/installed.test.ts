import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { installedDirectoriesOf, installRootsOf } from '@/sources/installed';
import {
  install,
  makeTempDirectory,
  TEMP_DIRECTORIES,
  writeSourceFile,
} from './source-repo.helper';

afterAll(() => {
  for (const directory of TEMP_DIRECTORIES) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('where a project installs its packages', () => {
  test('without a manifest the root is the only place', () => {
    const cwd = makeTempDirectory({ prefix: 'atlas-installed-' });

    expect(installRootsOf({ cwd })).toEqual([cwd]);
  });

  test('every package the manifest declares installs beside itself, so its folder counts too', () => {
    const cwd = makeTempDirectory({ prefix: 'atlas-installed-' });

    writeSourceFile({
      work: cwd,
      path: '.agents/vulcan.manifest.json',
      text: JSON.stringify({
        schemaVersion: 1,
        name: 'p',
        packages: [
          { name: 'api', dir: 'api', path: 'services/api', aliases: [], retired: false },
          { name: 'gone', dir: 'gone', path: 'services/gone', aliases: [], retired: true },
        ],
        knowledge: { bundle: '.agents/knowledge' },
        release: { tagPattern: '<dir>-v<version>', ignoreTags: [] },
      }),
    });
    mkdirSync(join(cwd, 'services/api'), { recursive: true });
    mkdirSync(join(cwd, 'services/gone'), { recursive: true });

    expect(installRootsOf({ cwd })).toEqual([cwd, join(cwd, 'services/api')]);
  });

  test('the nearest copy comes first, a missing one is not listed', () => {
    const cwd = makeTempDirectory({ prefix: 'atlas-installed-' });
    const app = join(cwd, 'services/api');

    install({ root: cwd, name: '@x/kernel', version: '1.0.0' });
    install({ root: app, name: '@x/kernel', version: '1.1.0' });
    install({ root: app, name: '@x/only-here', version: '2.0.0' });

    expect(installedDirectoriesOf({ roots: [cwd, app], name: '@x/kernel' })).toEqual([
      join(cwd, 'node_modules/@x/kernel'),
      join(app, 'node_modules/@x/kernel'),
    ]);
    expect(installedDirectoriesOf({ roots: [cwd, app], name: '@x/only-here' })).toEqual([
      join(app, 'node_modules/@x/only-here'),
    ]);
    expect(installedDirectoriesOf({ roots: [cwd, app], name: '@x/absent' })).toEqual([]);
  });
});
