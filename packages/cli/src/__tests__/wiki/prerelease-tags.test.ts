import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrereleaseTags } from '../../../../../docs/wiki/site/.vitepress/theme/shared/changelog-prereleases.ts';
import { createProject, removeProjects } from '../helpers/project.helper.ts';

afterAll(removeProjects);

const git = (root: string, ...args: string[]) =>
  Bun.spawnSync(['git', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  });

/** A repository with one commit and the tag of a prerelease, and the given manifest file in `.agents`. */
const repository = (opts: { file?: string }): string => {
  const root = createProject({ files: { 'a.txt': 'a\n' } });

  git(root, 'init', '-q');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'first');
  git(root, 'tag', 'core-v1.2.0-3');

  if (opts.file !== undefined) {
    mkdirSync(join(root, '.agents'), { recursive: true });
    writeFileSync(
      join(root, '.agents', opts.file),
      JSON.stringify({
        name: 'shop',
        packages: [{ name: '@x/core', dir: 'core' }],
        release: { tagPattern: '<dir>-v<version>' },
      }),
    );
  }

  return root;
};

describe('PrereleaseTags.read takes the tag layout from the committed descriptor', () => {
  test('the descriptor gives the newest prerelease; the manifest of an earlier release still works; neither gives none', () => {
    const fromDescriptor = PrereleaseTags.read({
      from: repository({ file: 'atlas.manifest.json' }),
    });
    const fromOld = PrereleaseTags.read({ from: repository({ file: 'vulcan.manifest.json' }) });
    const none = PrereleaseTags.read({ from: repository({}) });

    expect(fromDescriptor.packages['@x/core']?.['1.2.0']?.version).toBe('1.2.0-3');
    expect(fromOld.packages['@x/core']?.['1.2.0']?.version).toBe('1.2.0-3');
    expect(none).toEqual(PrereleaseTags.EMPTY);
  });
});
