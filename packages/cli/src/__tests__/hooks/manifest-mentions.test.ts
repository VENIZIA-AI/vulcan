import { describe, expect, test } from 'bun:test';
import { InlineScript } from '../../hooks/manifest-script.ts';

const CASES: { word: string; isClosed: boolean }[] = [
  // A plain path below an `agents` folder is neither the folder nor the manifest.
  { word: '.agents/local/tmp/gates.log', isClosed: true },
  { word: 'scripts/agents/etalon/scan-added.sh', isClosed: true },
  { word: '/home/me/proj/.agents/rules.md', isClosed: true },
  { word: '.agents/local/tmp/', isClosed: true },
  { word: '.AGENTS/Local/X.LOG', isClosed: true },
  { word: '.agents/rules.md', isClosed: true },
  // A simple variable or a glob in the last name, below a plain directory, cannot reach the file in `.agents`.
  { word: '.agents/plans/final/pending/$n.hashes', isClosed: true },
  { word: '.agents/plans/final/pending/${n}.hashes', isClosed: true },
  { word: '.agents/plans/*.json', isClosed: true },
  { word: '.agents/plans/a?.json', isClosed: true },
  // A trailing variable may hold slashes and `..`; a suffix that completes the name does too.
  { word: '.agents/local/$F', isClosed: false },
  { word: '.agents/local/${F}', isClosed: false },
  { word: '.agents/local/$n.json', isClosed: false },
  { word: '.agents/local/${n}son', isClosed: false },
  { word: '.agents/local/$n*', isClosed: false },
  { word: '.agents/local/$n.js?n', isClosed: false },
  // The folder itself, the manifest and a piece of its name are not closed.
  { word: '.agents', isClosed: false },
  { word: '.agents/', isClosed: false },
  { word: '.agents/vulcan.manifest.json', isClosed: false },
  { word: '.agents/local/vulcan.manifest.json', isClosed: false },
  { word: '.agents/*', isClosed: false },
  { word: '.agents/*.json', isClosed: false },
  { word: '.agents/lo?al', isClosed: false },
  { word: '.agents/$F', isClosed: false },
  { word: '.agents/pl$x/y', isClosed: false },
  { word: '.agents/plans/$d/y', isClosed: false },
  { word: '.agents/${F}/y', isClosed: false },
  { word: '.agents/plans/${x:-..}', isClosed: false },
  { word: '.agents/plans/$(echo x)', isClosed: false },
  { word: '.agents/plans/`echo x`', isClosed: false },
  { word: '.agents/plans/{a,b}', isClosed: false },
  { word: '.agents/local/../y', isClosed: false },
  { word: '.agents/plans/x/..', isClosed: false },
  { word: '.agents/./y', isClosed: false },
  { word: '.agents//y', isClosed: false },
  { word: '.agents/lo\\ cal/y', isClosed: false },
  // A prefix that is not plain, or no path at all.
  { word: '$D/.agents/local/x', isClosed: false },
  { word: '$(pwd)/.agents/local/x', isClosed: false },
  { word: 'agents', isClosed: false },
  { word: 'ls', isClosed: false },
  // Characters that change length in lower case are not read.
  { word: 'İ/.agents/local/x', isClosed: false },
];

describe('InlineScript.isClosedPath', () => {
  for (const item of CASES) {
    test(`${item.isClosed ? 'closed' : 'open'}: ${item.word}`, () => {
      expect(InlineScript.isClosedPath({ word: item.word })).toBe(item.isClosed);
    });
  }

  test('a long run of agents/ components costs time in step with its length', () => {
    const sizes = [20_000, 80_000];
    const times: number[] = [];

    for (const size of sizes) {
      const closed = `${'agents/a'.repeat(size)}`;
      const open = `${'agents/a/'.repeat(size)}$(x)`;
      const broken = `${'agents/a/../'.repeat(size)}`;
      const started = performance.now();

      expect(InlineScript.isClosedPath({ word: closed })).toBe(true);
      expect(InlineScript.isClosedPath({ word: open })).toBe(false);
      expect(InlineScript.isClosedPath({ word: broken })).toBe(false);

      times.push(performance.now() - started);
    }

    expect(times[1] ?? Infinity).toBeLessThan(2000);
    // Four times the text must not cost sixteen times the time.
    expect((times[1] ?? Infinity) / Math.max(times[0] ?? 1, 1)).toBeLessThan(12);
  });
});

describe('InlineScript.agentsCount', () => {
  test('counts every mention of agents as letters', () => {
    expect(InlineScript.agentsCount({ text: 'ls .agents/a; cp x scripts/agents/b' })).toBe(2);
    expect(InlineScript.agentsCount({ text: 'ls .age"nts"/a' })).toBe(1);
    expect(InlineScript.agentsCount({ text: 'ls src' })).toBe(0);
  });
});
