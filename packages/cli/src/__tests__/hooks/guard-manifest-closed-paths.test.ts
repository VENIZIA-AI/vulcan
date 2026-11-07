import { afterAll, describe, expect, test } from 'bun:test';
import { symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { ManifestGuard } from '../../hooks/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { MANIFEST } from '../manifest-hook.helper.ts';

afterAll(removeProjects);

/** A project with a folder under `.agents/local` that is a link to `.agents` itself. */
const projectWithLink = (): string => {
  const root = createProject({
    files: {
      [MANIFEST]: '{}\n',
      '.agents/local/tmp/run.log': 'l\n',
      'scripts/agents/tool.ts': 't\n',
      x: 'x\n',
    },
  });

  symlinkSync('..', join(root, '.agents/local/up'));

  return root;
};

const isDenied = (opts: { root: string; command: string }): boolean =>
  ManifestGuard.inspectWrite({
    input: { tool: 'Bash', filePath: undefined, command: opts.command, cwd: opts.root },
  });

describe('a closed path with a link below its agents folder is a mention', () => {
  const root = projectWithLink();

  test('a loop over a link that leads back to the folder is denied', () => {
    for (const command of [
      'for f in .agents/local/up/*.json; do cp x $f; done',
      'for f in .agents/local/up/vulcan*; do cp x $f; done',
      'G=.agents/local/up/vulcan.manifest.json; for f in $G; do cp x $f; done',
    ]) {
      expect(isDenied({ root, command }), command).toBe(true);
    }
  });

  test('an argument through the link keeps the line about the folder', () => {
    // The link is read by the check, so `cat` of a closed path through it is a mention that makes `$DEST` suspect.
    expect(isDenied({ root, command: 'cat .agents/local/up/rules.md; cp x $DEST' })).toBe(true);
  });

  test('the same words without a link are allowed', () => {
    for (const command of [
      'for f in .agents/local/tmp/*.log; do cat $f; done; cp x $DEST',
      'cat .agents/local/tmp/run.log; cp x $DEST',
      'cat scripts/agents/tool.ts; cp x $DEST',
    ]) {
      expect(isDenied({ root, command }), command).toBe(false);
    }
  });
});
