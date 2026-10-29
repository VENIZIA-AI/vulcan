import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..', '..');
const WORKFLOW = readFileSync(join(ROOT, '.github', 'workflows', 'package-release.yml'), 'utf8');
const MANIFEST = JSON.parse(readFileSync(join(ROOT, '.agents', 'vulcan.manifest.json'), 'utf8'));

/** The tag the workflow names for a version: its TAG_NAME line with the version put in. */
const tagFor = (opts: { version: string }): string => {
  const line = WORKFLOW.split('\n').find(
    (entry) => entry.includes('TAG_NAME=') && entry.includes('GITHUB_ENV'),
  );

  if (line === undefined) {
    throw new Error('[tagFor] no TAG_NAME line in package-release.yml');
  }

  const name = /TAG_NAME=([^"]+)"/.exec(line)?.[1] ?? '';

  return name.replace('$NEW_VERSION', opts.version);
};

describe('the name of a VULCAN release tag', () => {
  test('is vulcan-v<version>, for a stable and for a prerelease', () => {
    expect(tagFor({ version: '0.4.8' })).toBe('vulcan-v0.4.8');
    expect(tagFor({ version: '0.4.9-0' })).toBe('vulcan-v0.4.9-0');
  });

  test('matches the one tag ruleset the three repositories share, *-v*, and is not the atlas-index tag', () => {
    const glob = new Bun.Glob('*-v*');

    expect(glob.match(tagFor({ version: '0.4.8' }))).toBe(true);
    expect(glob.match('atlas-index')).toBe(false);
    expect(glob.match('v0.4.7')).toBe(false);
  });

  test("the manifest's template names the tag the workflow makes, and its legacy template the old form", () => {
    const { tagPattern, legacyTagPatterns } = MANIFEST.release;

    expect(tagPattern.replace('<version>', '0.4.8')).toBe(tagFor({ version: '0.4.8' }));
    expect(legacyTagPatterns).toEqual(['v<version>']);
  });
});
