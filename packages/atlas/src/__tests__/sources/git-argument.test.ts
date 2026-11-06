import { describe, expect, test } from 'bun:test';
import { GitArgument } from '@/common/git-argument';
import { ProjectConfig } from '@/common/project-config';
import { GitRepository } from '@/sources/git';

describe('GitArgument.isOptionLike', () => {
  test('a value that starts with a dash, after any space, is read by git as an option', () => {
    for (const value of ['-x', '--version', '  --version', '-']) {
      expect(GitArgument.isOptionLike({ value }), value).toBe(true);
    }

    for (const value of [
      'owner/repo',
      'https://example.com/a.git',
      '/srv/git/a.git',
      'a-b',
      'develop',
    ]) {
      expect(GitArgument.isOptionLike({ value }), value).toBe(false);
    }
  });
});

describe('a repository that git would read as an option', () => {
  test('git is not asked: the remote is unreachable, and a clone is refused', () => {
    expect(GitRepository.lsRemote({ url: '--version', ref: 'develop' })).toEqual({
      reachable: false,
    });
    expect(
      GitRepository.lsRemote({ url: 'https://example.invalid/a.git', ref: '--version' }),
    ).toEqual({
      reachable: false,
    });
    expect(() =>
      GitRepository.updateClone({ url: '--version', gitDir: '.agents/local/tmp/none' }),
    ).toThrow("the repository must not start with '-'");
  });
});

describe('sources of the manifest', () => {
  test('a source whose repo or ref starts with a dash is left out, the others stay', () => {
    const project = ProjectConfig.toAtlasProject({
      root: '.',
      manifest: {
        schemaVersion: 1,
        sources: [
          { name: 'good', repo: 'acme/good', ref: 'develop' },
          { name: 'bad-repo', repo: '--version', ref: 'develop' },
          { name: 'bad-ref', repo: 'acme/other', ref: '-x' },
        ],
      },
    });

    expect(project.sources.map((source) => source.name)).toEqual(['good']);
  });
});
