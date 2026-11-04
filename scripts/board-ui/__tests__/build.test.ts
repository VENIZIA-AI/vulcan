import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BoardUiBuild } from '../build.ts';

const ROOT = join(import.meta.dir, '..', '..', '..');

describe('BoardUiBuild.build', () => {
  test('the page is the shell with one inline script, one data marker and one mount point', async () => {
    const html = await BoardUiBuild.build({ root: ROOT });

    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html.match(/<!--BOARD_DATA-->/g)).toHaveLength(1);
    expect(html.match(/<div id="root"><\/div>/g)).toHaveLength(1);
    expect(html.match(/<script>/g)).toHaveLength(1);
    expect(html).not.toContain('<!--BOARD_SCRIPT-->');
  });

  test('nothing in the bundle can end its own script tag or open a comment', async () => {
    const html = await BoardUiBuild.build({ root: ROOT });
    const script = html.slice(
      html.indexOf('<script>') + '<script>'.length,
      html.lastIndexOf('</script>'),
    );

    expect(script).not.toContain('</script');
    expect(script).not.toContain('<!--');
  });

  test('the build is deterministic, and it is self-contained: no network, no external script or style', async () => {
    const first = await BoardUiBuild.build({ root: ROOT });
    const second = await BoardUiBuild.build({ root: ROOT });

    expect(second).toBe(first);
    expect(first).not.toMatch(/<(?:script|link)[^>]+(?:src|href)="https?:/);
  });

  test('the shipped page is the build of its source: run `make board-ui` after a change to packages/cli/src/board/ui', async () => {
    const shipped = readFileSync(join(ROOT, 'packages/cli/base/templates/board.html'), 'utf8');

    expect(shipped).toContain(`built from ${BoardUiBuild.sourceHash({ root: ROOT })};`);
  });

  test('on the Bun the project pins, the shipped page is the build of its source to the byte', async () => {
    const pinned = readFileSync(join(ROOT, '.bun-version'), 'utf8').trim();
    const shipped = readFileSync(join(ROOT, 'packages/cli/base/templates/board.html'), 'utf8');

    if (Bun.version === pinned) {
      expect(shipped).toBe(await BoardUiBuild.build({ root: ROOT }));
    } else {
      console.warn(`board page byte check skipped: Bun ${Bun.version} is not the pinned ${pinned}`);
    }
  });

  test('a build that fails says why and writes nothing', async () => {
    await expect(
      BoardUiBuild.bundle({ root: ROOT, entry: 'packages/cli/src/board/ui/missing.tsx' }),
    ).rejects.toThrow('the board UI did not build');
  });
});
