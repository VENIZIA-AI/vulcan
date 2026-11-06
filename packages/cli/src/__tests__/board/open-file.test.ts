import { afterAll, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { BoardOpenFile } from '../../board/open-file.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const URL_WITH_TOKEN = 'http://board.localhost:4317/?t=0123456789abcdef0123456789abcdef';
const folderOf = (): string => join(createProject({ files: {} }), 'tmp');
const ageOf = (opts: { path: string; ms: number }): void => {
  const when = new Date(Date.now() - opts.ms);

  utimesSync(opts.path, when, when);
};

describe('BoardOpenFile.write', () => {
  test('the page is index.html in a new folder that only its owner can use', () => {
    const folder = folderOf();
    const { path, directory } = BoardOpenFile.write({ folder, url: URL_WITH_TOKEN });

    expect(dirname(directory)).toBe(folder);
    expect(basename(directory)).toMatch(/^board-open-/);
    expect(path).toBe(join(directory, 'index.html'));
    expect(statSync(directory).mode & 0o777).toBe(0o700);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(directory).uid).toBe(process.getuid?.() ?? statSync(directory).uid);
    expect(readFileSync(path, 'utf8')).toContain(`content="0;url=${URL_WITH_TOKEN}"`);
  });

  test('the folder is private whatever the umask of the process says', () => {
    const folder = folderOf();
    const before = process.umask(0o000);

    try {
      const { directory, path } = BoardOpenFile.write({ folder, url: URL_WITH_TOKEN });

      expect(statSync(directory).mode & 0o777).toBe(0o700);
      expect(statSync(path).mode & 0o777).toBe(0o600);
    } finally {
      process.umask(before);
    }
  });

  test('each call has a folder of its own', () => {
    const folder = folderOf();
    const first = BoardOpenFile.write({ folder, url: URL_WITH_TOKEN });
    const second = BoardOpenFile.write({ folder, url: URL_WITH_TOKEN });

    expect(first.directory).not.toBe(second.directory);
  });

  test('a tmp folder that is a link to a folder anyone can write still gets a private folder, and the page is not loose in it', () => {
    const open = createProject({ files: {} });
    const link = join(createProject({ files: {} }), 'tmp');

    chmodSync(open, 0o777);
    symlinkSync(open, link);

    const { directory, path } = BoardOpenFile.write({ folder: link, url: URL_WITH_TOKEN });

    expect(dirname(directory)).toBe(link);
    expect(readdirSync(open)).toEqual([basename(directory)]);
    expect(statSync(directory).mode & 0o777).toBe(0o700);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  test('a folder that is not ours is refused and not left behind', () => {
    const folder = folderOf();
    const uid = process.getuid?.();

    if (uid === undefined) {
      return;
    }

    expect(() => BoardOpenFile.write({ folder, url: URL_WITH_TOKEN, uid: uid + 1 })).toThrow(
      'not a private folder',
    );
    expect(readdirSync(folder)).toEqual([]);
  });
});

describe('BoardOpenFile.remove', () => {
  test('the page and its folder go, and one that is already gone is no error', () => {
    const { directory } = BoardOpenFile.write({ folder: folderOf(), url: URL_WITH_TOKEN });

    BoardOpenFile.remove({ directory });
    expect(existsSync(directory)).toBe(false);
    expect(() => BoardOpenFile.remove({ directory })).not.toThrow();
  });
});

describe('BoardOpenFile.sweep', () => {
  const stale = (folder: string, name: string, ms: number): string => {
    const directory = join(folder, name);

    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'index.html'), 'x');
    ageOf({ path: directory, ms });

    return directory;
  };

  test('a folder of ours older than a minute goes, a younger one stays', () => {
    const folder = folderOf();
    const old = stale(folder, 'board-open-old', 2 * 60_000);
    const fresh = stale(folder, 'board-open-new', 10_000);

    BoardOpenFile.sweep({ folder });

    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });

  test('write sweeps before it makes its own folder', () => {
    const folder = folderOf();
    const old = stale(folder, 'board-open-old', 2 * 60_000);
    const { directory } = BoardOpenFile.write({ folder, url: URL_WITH_TOKEN });

    expect(existsSync(old)).toBe(false);
    expect(existsSync(directory)).toBe(true);
  });

  test('only folders named board-open-* are touched: other files and folders stay however old', () => {
    const folder = folderOf();
    const other = stale(folder, 'scratch', 2 * 60_000);
    const file = join(folder, 'board-open-file.html');

    writeFileSync(file, 'x');
    ageOf({ path: file, ms: 2 * 60_000 });

    BoardOpenFile.sweep({ folder });

    expect(existsSync(other)).toBe(true);
    expect(existsSync(file)).toBe(true);
  });

  test('a link named board-open-* is not followed', () => {
    const folder = folderOf();
    const target = stale(folder, 'elsewhere', 2 * 60_000);

    symlinkSync(target, join(folder, 'board-open-link'));
    BoardOpenFile.sweep({ folder });

    expect(existsSync(join(target, 'index.html'))).toBe(true);
  });

  test('a folder that does not exist, or is not ours, is no error', () => {
    const folder = folderOf();
    const uid = process.getuid?.();

    expect(() => BoardOpenFile.sweep({ folder })).not.toThrow();

    const old = stale(folder, 'board-open-old', 2 * 60_000);

    if (uid !== undefined) {
      BoardOpenFile.sweep({ folder, uid: uid + 1 });
      expect(existsSync(old)).toBe(true);
    }
  });
});
