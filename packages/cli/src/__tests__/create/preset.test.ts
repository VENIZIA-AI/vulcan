import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { copyPresetFiles, locatePreset, parsePresetSpec } from '../../create/preset.ts';
import type { ILocatedPreset } from '../../create/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const FIXTURE = join(import.meta.dir, '..', 'fixtures', 'preset-backend');
const FRONTEND_FIXTURE = join(import.meta.dir, '..', 'fixtures', 'preset-frontend');

const PRESET_JSON = JSON.stringify({
  presetVersion: 1,
  side: 'backend',
  summary: 'A throwaway preset.',
  devPort: 3000,
  files: './files',
});

const locateFixture = (opts: { path: string }): ILocatedPreset => {
  const result = locatePreset({ spec: { range: `file:${opts.path}` }, root: '/unused' });

  if (!result.ok) {
    throw new Error(result.error);
  }

  return result.located;
};

describe('parsePresetSpec', () => {
  test('a bare name resolves to its package in the framework scope, on latest', () => {
    expect(parsePresetSpec({ value: 'widget', cwd: '/x' })).toEqual({
      packageName: '@venizia/widget',
      range: 'latest',
    });
  });

  test('a bare name with a version keeps it', () => {
    expect(parsePresetSpec({ value: 'widget@0.1.5', cwd: '/x' })).toEqual({
      packageName: '@venizia/widget',
      range: '0.1.5',
    });
  });

  test('a scoped name with a version', () => {
    expect(parsePresetSpec({ value: '@acme/kit@2', cwd: '/x' })).toEqual({
      packageName: '@acme/kit',
      range: '2',
    });
  });

  test('a scoped name without a version is on latest', () => {
    expect(parsePresetSpec({ value: '@acme/kit', cwd: '/x' })).toEqual({
      packageName: '@acme/kit',
      range: 'latest',
    });
  });

  test('a file: path becomes absolute', () => {
    expect(parsePresetSpec({ value: 'file:./kit', cwd: '/work' })).toEqual({
      range: 'file:/work/kit',
    });
  });
});

describe('locatePreset', () => {
  test('a file: preset is read from its folder', () => {
    const result = locatePreset({ spec: { range: `file:${FIXTURE}` }, root: '/unused' });

    expect(result.ok && result.located.packageName).toBe('@fixture/backend');
    expect(result.ok && result.located.packageVersion).toBe('1.2.3');
    expect(result.ok && result.located.preset.side).toBe('backend');
    expect(result.ok && result.located.preset.files).toBe(join(FIXTURE, 'vulcan-preset', 'files'));
  });

  test('the frontend fixture carries its peers', () => {
    const located = locateFixture({ path: FRONTEND_FIXTURE });

    expect(located.preset.side).toBe('frontend');
    expect(located.preset.peers).toEqual({ '@fixture/lib': '^1.0.0' });
  });

  test('an installed preset is read from node_modules', () => {
    const root = createProject({
      files: {
        'node_modules/@acme/kit/package.json':
          '{ "name": "@acme/kit", "version": "1.0.0", "vulcan": { "preset": "./p.json" } }',
        'node_modules/@acme/kit/p.json': PRESET_JSON,
      },
    });
    const result = locatePreset({ spec: { packageName: '@acme/kit', range: 'latest' }, root });

    expect(result.ok && result.located.packageName).toBe('@acme/kit');
    expect(result.ok && result.located.preset.files).toBe(
      join(root, 'node_modules/@acme/kit', 'files'),
    );
  });

  test('a presetVersion newer than this VULCAN is refused', () => {
    const root = createProject({
      files: {
        'node_modules/@acme/kit/package.json':
          '{ "name": "@acme/kit", "version": "1.0.0", "vulcan": { "preset": "./p.json" } }',
        'node_modules/@acme/kit/p.json': '{ "presetVersion": 2 }',
      },
    });
    const result = locatePreset({ spec: { packageName: '@acme/kit', range: 'latest' }, root });

    expect(result).toEqual({
      ok: false,
      error:
        '@acme/kit@1.0.0 has preset version 2; this VULCAN reads version 1 - upgrade @venizia/vulcan',
    });
  });

  test('a package without a vulcan.preset field is refused', () => {
    const root = createProject({
      files: { 'node_modules/left-pad/package.json': '{ "name": "left-pad", "version": "1.0.0" }' },
    });

    expect(locatePreset({ spec: { packageName: 'left-pad', range: 'latest' }, root })).toEqual({
      ok: false,
      error:
        'left-pad@1.0.0 ships no VULCAN preset (no "vulcan": { "preset" } in its package.json)',
    });
  });

  test('a missing package is refused', () => {
    const root = createProject({ files: {} });
    const result = locatePreset({ spec: { packageName: '@acme/none', range: 'latest' }, root });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain('no package at');
  });

  test('a preset.json that breaks the schema is refused with the field named', () => {
    const root = createProject({
      files: {
        'node_modules/@acme/kit/package.json':
          '{ "name": "@acme/kit", "version": "1.0.0", "vulcan": { "preset": "./p.json" } }',
        'node_modules/@acme/kit/p.json': JSON.stringify({
          presetVersion: 1,
          side: 'sideways',
          summary: 'x',
          devPort: 3000,
          files: './files',
        }),
      },
    });
    const result = locatePreset({ spec: { packageName: '@acme/kit', range: 'latest' }, root });

    expect(!result.ok && result.error).toContain('side');
  });
});

describe('copyPresetFiles', () => {
  test('tokens are substituted, _ files renamed, a real dotfile kept', () => {
    const target = createProject({ files: {} });
    const written = copyPresetFiles({
      located: locateFixture({ path: FIXTURE }),
      target,
      tokens: { project: 'my-product', app: 'core-api', devPort: '3001' },
    });

    expect(written.sort()).toEqual(['.env.example', '.keep-real-dotfile', 'src/index.ts']);
    expect(readFileSync(join(target, 'src/index.ts'), 'utf8')).toContain(
      'core-api of my-product on 3001',
    );
    expect(readFileSync(join(target, '.env.example'), 'utf8')).toBe('APP_ENV_SERVER_PORT=3001');
    expect(readFileSync(join(target, '.keep-real-dotfile'), 'utf8')).toBe('kept');
    expect(existsSync(join(target, '_env.example'))).toBe(false);
  });

  test('a file: preset holding .env.example under its real name copies it as is', () => {
    const source = createProject({
      files: {
        'package.json':
          '{ "name": "@acme/kit", "version": "1.0.0", "vulcan": { "preset": "./preset.json" } }',
        'preset.json': PRESET_JSON,
        'files/.env.example': 'APP_ENV_SERVER_PORT={{devPort}}',
        'files/.config/tool.json': '{}',
      },
    });
    const target = createProject({ files: {} });
    const written = copyPresetFiles({
      located: locateFixture({ path: source }),
      target,
      tokens: { devPort: '3002' },
    });

    expect(written.sort()).toEqual(['.config/tool.json', '.env.example']);
    expect(readFileSync(join(target, '.env.example'), 'utf8')).toBe('APP_ENV_SERVER_PORT=3002');
  });

  test('only the file name is renamed, never a folder, and a nested _ file becomes a dotfile', () => {
    const source = createProject({
      files: {
        'package.json':
          '{ "name": "@acme/kit", "version": "1.0.0", "vulcan": { "preset": "./preset.json" } }',
        'preset.json': PRESET_JSON,
        'files/_env.example': 'a',
        'files/deploy/_gitignore': 'b',
        'files/_private/readme.md': 'c',
      },
    });
    const target = createProject({ files: {} });
    const written = copyPresetFiles({
      located: locateFixture({ path: source }),
      target,
      tokens: {},
    });

    expect(written.sort()).toEqual(['.env.example', '_private/readme.md', 'deploy/.gitignore']);
  });

  test('an unknown token is left as written', () => {
    const source = createProject({
      files: {
        'package.json':
          '{ "name": "@acme/kit", "version": "1.0.0", "vulcan": { "preset": "./preset.json" } }',
        'preset.json': PRESET_JSON,
        'files/note.txt': '{{app}} {{unknown}}',
      },
    });
    const target = createProject({ files: {} });

    copyPresetFiles({ located: locateFixture({ path: source }), target, tokens: { app: 'core' } });

    expect(readFileSync(join(target, 'note.txt'), 'utf8')).toBe('core {{unknown}}');
  });
});
