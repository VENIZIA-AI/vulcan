import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createProject, removeProjects } from '../helpers/project.helper.ts';
import { BrowserPage } from './browser.helper.ts';

afterAll(removeProjects);

describe("BrowserPage.scratchOf: the folder of this run's own Chrome", () => {
  const profileWithLink = (opts: { target: string }): string => {
    const profile = join(createProject({ files: {} }), 'profile');

    mkdirSync(profile, { recursive: true });
    symlinkSync(opts.target, join(profile, 'SingletonSocket'));

    return profile;
  };

  test('is the folder the link names, when it sits directly in the temp folder and is a Chrome scratch folder', () => {
    const short = createProject({ files: {} });

    for (const name of [
      'com.google.Chrome.AbC123',
      '.com.google.Chrome.AbC123',
      'org.chromium.Chromium.x1',
    ]) {
      const profile = profileWithLink({ target: join(short, name, 'SingletonSocket') });

      expect(BrowserPage.scratchOf({ profile, short }), name).toBe(join(short, name));
    }
  });

  test('is nothing when the link points elsewhere, at another kind of folder, or does not exist', () => {
    const short = createProject({ files: {} });
    const other = createProject({ files: {} });

    expect(
      BrowserPage.scratchOf({
        profile: profileWithLink({ target: join(other, 'com.google.Chrome.x', 'SingletonSocket') }),
        short,
      }),
    ).toBeUndefined();
    expect(
      BrowserPage.scratchOf({
        profile: profileWithLink({ target: join(short, 'precious', 'SingletonSocket') }),
        short,
      }),
    ).toBeUndefined();
    expect(
      BrowserPage.scratchOf({
        profile: profileWithLink({
          target: join(short, 'a', 'com.google.Chrome.x', 'SingletonSocket'),
        }),
        short,
      }),
    ).toBeUndefined();
    expect(
      BrowserPage.scratchOf({ profile: join(createProject({ files: {} }), 'none'), short }),
    ).toBeUndefined();
  });
});

describe('BrowserPage.candidatesOf: the folders tried for the temp folder of Chrome, in order', () => {
  test("the project's configured folder comes before the old places", () => {
    const root = createProject({
      files: {
        '.agents/local/profile.json': JSON.stringify({ common: { local: { tmp: 'tmp' } } }),
        'tmp/.keep': '',
        '.agents/local/tmp/.keep': '',
      },
    });
    const folder = createProject({ files: {} });

    expect(BrowserPage.candidatesOf({ root, folder, override: undefined })).toEqual([
      join(root, 'tmp'),
      join(root, '.agents', 'local', 'tmp'),
      join(root, '.agents', 'local'),
      folder,
    ]);
  });

  test('a named folder comes first; one that does not exist, or comes twice, is left out', () => {
    const root = createProject({ files: { '.agents/tmp/.keep': '' } });
    const folder = createProject({ files: {} });
    const override = createProject({ files: {} });

    expect(BrowserPage.candidatesOf({ root, folder, override })).toEqual([
      override,
      join(root, '.agents', 'tmp'),
      folder,
    ]);
    expect(
      BrowserPage.candidatesOf({ root, folder: override, override }).filter(
        (entry) => entry === override,
      ),
    ).toHaveLength(1);
  });
});
