import { afterAll, describe, expect, test } from 'bun:test';
import { VULCAN_CONFIG_SCHEMA } from '../../config/index.ts';
import { ProjectManifest } from '../../manifest/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const MIB = 1024 * 1024;
const root = createProject({ files: { 'package.json': '{ "name": "@x/acme-workspace" }' } });

const parse = (atlas: unknown) => VULCAN_CONFIG_SCHEMA.safeParse({ atlas });
const messagesOf = (atlas: unknown): string => {
  const result = parse(atlas);

  return result.success ? '' : result.error.issues.map((issue) => issue.message).join('\n');
};
const render = (atlas: object): { atlas?: Record<string, unknown> } =>
  JSON.parse(ProjectManifest.render({ root, config: VULCAN_CONFIG_SCHEMA.parse({ atlas }) }));

describe('atlas.limits.download', () => {
  test('is unset by default, and the manifest then says nothing about it', () => {
    expect(VULCAN_CONFIG_SCHEMA.parse({}).atlas.limits).toBeUndefined();
    expect(render({}).atlas).toBeUndefined();
  });

  test.each([MIB, 5 * MIB, 128 * MIB, 1024 * MIB])('accepts %i bytes', (download) => {
    const result = parse({ limits: { download } });

    expect(result.success).toBe(true);
    expect(result.data?.atlas.limits?.download).toBe(download);
  });

  test.each([
    ['0', 0],
    ['one byte', 1],
    ['a byte under 1 MiB', MIB - 1],
    ['a byte over 1 GiB', 1024 * MIB + 1],
    ['a negative number', -5 * MIB],
    ['a fraction', 1.5 * MIB + 0.5],
    ['a string', '5242880'],
    ['null', null],
  ])('rejects %s', (_name, download) => {
    expect(parse({ limits: { download } }).success).toBe(false);
  });

  test('an unknown key under limits is rejected', () => {
    expect(parse({ limits: { downloads: 5 * MIB } }).success).toBe(false);
    expect(parse({ limits: { download: 5 * MIB, upload: 1 } }).success).toBe(false);
  });

  test('is written to the manifest, where atlas reads it, next to the other atlas settings', () => {
    expect(render({ limits: { download: 5 * MIB } }).atlas).toEqual({
      limits: { download: 5 * MIB },
    });
    expect(render({ prebuilt: false, limits: { download: 5 * MIB } }).atlas).toEqual({
      prebuilt: false,
      limits: { download: 5 * MIB },
    });
  });
});

describe('atlas.sources[].repo', () => {
  const source = (repo: string) => ({ sources: [{ name: 'ignis', repo, ref: 'develop' }] });

  test.each([
    ['http://example.test/a.git', 'http://, which is clear text'],
    ['HTTP://example.test/a.git', 'http://, which is clear text'],
    ['git://example.test/a.git', 'git://, which is clear text'],
    ['ext::sh -c id', 'a remote-helper URL, which runs a command'],
    ['fd::3', 'a remote-helper URL, which runs a command'],
  ])('%p is refused, naming the source and saying to use https or ssh', (repo, what) => {
    const message = messagesOf(source(repo));

    expect(message).toContain("source 'ignis'");
    expect(message).toContain(what);
    expect(message).toContain('use https or ssh');
  });

  test.each([
    'VENIZIA-AI/ignis',
    'https://example.test/a.git',
    'ssh://git@example.test/a.git',
    'git@example.test:owner/repo.git',
    'file:///srv/git/a.git',
    '/srv/git/a.git',
    'owner/git-http.git',
  ])('%p is accepted', (repo) => {
    expect(parse(source(repo)).success).toBe(true);
  });

  test('a repository that starts with a dash is still refused, as before', () => {
    expect(messagesOf(source('--upload-pack=x'))).toContain("must not start with '-'");
  });
});
