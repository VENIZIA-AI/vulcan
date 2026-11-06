import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';
import { git } from '../git-repo.helper.ts';
import { createProject } from '../project.helper.ts';

const MANIFEST = '.agents/vulcan.manifest.json';

/**
 * A project for the case table: a manifest that differs between HEAD~1 and HEAD, patches and mailbox patches
 * for it and for another file, a second copy of `.agents`, links, a named pipe, and two stashes (the second
 * one down holds the manifest).
 */
export const buildTableProject = (): string => {
  const root = createProject({
    files: {
      [MANIFEST]: '{"v":1}\n',
      '.agents/rules.md': '# rules\nalpha\n',
      'src/a.ts': 'export const a = 1;\n',
      'src/b.ts': 'export const b = 1;\n',
      'web/public/manifest.json': '{"name":"web"}\n',
      'README.md': '# readme\nline\n',
      '.gitignore': '.agents/local/\nnode_modules/\n',
    },
  });
  const run = (...args: string[]): string => git({ cwd: root, args });
  const write = (path: string, text: string): void => writeFileSync(join(root, path), text);

  run('init', '-q', '-b', 'main');
  run('config', 'user.name', 'Test');
  run('config', 'user.email', 'test@example.dev');
  run('config', 'commit.gpgsign', 'false');
  run('add', '-A');
  run('commit', '-q', '-m', 'one');
  write(MANIFEST, '{"v":2}\n');
  write('src/a.ts', 'export const a = 2;\n');
  run('add', '-A');
  run('commit', '-q', '-m', 'two');
  run('branch', 'old', 'HEAD~1');

  mkdirSync(join(root, 'patches'));
  write('src/a.ts', 'export const a = 3;\n');
  write('patches/ordinary.patch', `${run('diff')}\n`);
  run('checkout', '-q', '--', 'src/a.ts');
  write(MANIFEST, '{"v":7}\n');
  write('patches/manifest.patch', `${run('diff')}\n`);
  run('checkout', '-q', '--', MANIFEST);
  write('README.md', '# readme\nline\nregenerate .agents/vulcan.manifest.json with vulcan sync\n');
  write('patches/docs.patch', `${run('diff')}\n`);
  run('checkout', '-q', '--', 'README.md');

  run('checkout', '-q', '-b', 'tmp');
  write('src/b.ts', 'export const b = 5;\n');
  run('commit', '-q', '-am', 'src change');
  run('format-patch', '-q', '-1', '-o', 'patches/');
  spawnSyncBounded({
    cmd: ['sh', '-c', 'mv patches/0001-*.patch patches/am-src.patch'],
    cwd: root,
  });
  write(MANIFEST, '{"v":8}\n');
  run('commit', '-q', '-am', 'manifest change');
  run('format-patch', '-q', '-1', '-o', 'patches/');
  spawnSyncBounded({
    cmd: ['sh', '-c', 'mv patches/0001-*.patch patches/am-manifest.patch'],
    cwd: root,
  });
  run('checkout', '-q', 'main');
  run('branch', '-q', '-D', 'tmp');

  mkdirSync(join(root, 'copy/.agents'), { recursive: true });
  write('copy/.agents/vulcan.manifest.json', '{"v":"copy"}\n');
  write('copy/.agents/rules.md', '# other rules\n');
  write('manifest.bak', '{"v":1}\n');
  write('list.txt', `${MANIFEST}\n`);
  write('list0.txt', `${MANIFEST}\0`);
  write('other.json', '{"x":1}\n');
  write('a.log', 'x\n');
  mkdirSync(join(root, '.agents/local/tmp'), { recursive: true });
  mkdirSync(join(root, 'node_modules/pkg'), { recursive: true });
  mkdirSync(join(root, 'dist'));
  write('.agents/local/tmp/x.txt', 'x\n');
  write('node_modules/pkg/index.js', 'x\n');
  spawnSyncBounded({ cmd: ['tar', '-czf', 'dist.tgz', 'src'], cwd: root });
  symlinkSync('.agents', join(root, 'ag'));
  symlinkSync(MANIFEST, join(root, 'mlink'));
  symlinkSync('loop1', join(root, 'loop2'));
  symlinkSync('loop2', join(root, 'loop1'));
  symlinkSync('/dev/zero', join(root, 'zero.patch'));
  spawnSyncBounded({ cmd: ['mkfifo', join(root, 'fifo.patch')] });

  write(MANIFEST, '{"v":9}\n');
  run('stash', 'push', '-q', '-m', 'manifest-stash', '--', MANIFEST);
  write('src/b.ts', 'export const b = 9;\n');
  run('stash', 'push', '-q', '-m', 'src-stash', '--', 'src/b.ts');

  return root;
};
