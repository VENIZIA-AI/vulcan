import { describe, expect, test } from 'bun:test';
import { InlineScript } from '../../hooks/manifest-script.ts';

const CASES: { text: string; isAbout: boolean }[] = [
  // A plain path below an `agents` folder says nothing about the manifest.
  { text: 'tail -3 .agents/local/tmp/gates.log', isAbout: false },
  { text: 'bash scripts/agents/etalon/scan-added.sh .agents/local/tmp/own2.txt', isAbout: false },
  { text: 'ls .agents/local/tmp/', isAbout: false },
  { text: 'cat "/home/me/proj/.agents/rules.md" | wc -l', isAbout: false },
  { text: 'cat .AGENTS/Local/X.LOG', isAbout: false },
  // The folder itself, the manifest and a piece of its name do.
  { text: 'cd .agents', isAbout: true },
  { text: 'ls .agents; ls .agents/', isAbout: true },
  { text: 'cat .agents/vulcan.manifest.json', isAbout: true },
  { text: 'ls .agents/local/vulcan.manifest.json', isAbout: true },
  { text: 'rm .agents/*', isAbout: true },
  { text: 'rm .agents/lo?al', isAbout: true },
  { text: 'cp x .agents/$F', isAbout: true },
  // A simple variable or a glob in the last name, below a plain directory, cannot reach the file in `.agents`.
  { text: 'cp x .agents/local/$F', isAbout: false },
  { text: 'cat .agents/plans/final/pending/$n.hashes', isAbout: false },
  { text: 'cat .agents/plans/final/pending/${n}.hashes', isAbout: false },
  { text: 'ls .agents/plans/*.json', isAbout: false },
  { text: 'ls .agents/plans/a?.json', isAbout: false },
  { text: 'ls .agents/*.json', isAbout: true },
  { text: 'ls .agents/pl$x/y', isAbout: true },
  { text: 'ls .agents/plans/$d/y', isAbout: true },
  { text: 'ls .agents/plans/${x:-..}', isAbout: true },
  { text: 'ls .agents/plans/$(echo x)', isAbout: true },
  { text: 'ls .agents/plans/`echo x`', isAbout: true },
  { text: 'ls .agents/plans/{a,b}', isAbout: true },
  { text: 'ls .agents/plans/x/..', isAbout: true },
  { text: 'ls .agents/', isAbout: true },
  { text: 'cp x .agents/${F}/y', isAbout: true },
  { text: 'cp x .agents/`pwd`/y', isAbout: true },
  { text: 'cp x .agents/local/../y', isAbout: true },
  { text: 'cp x .agents/./y', isAbout: true },
  { text: 'cp x .agents//y', isAbout: true },
  { text: 'cp x .agents/lo\\ cal/y', isAbout: true },
  { text: 'cp x .agents/{a,b}/y', isAbout: true },
  { text: 'a=.agents; cp x $a/y', isAbout: true },
  { text: 'x=$(printf "%s" .agents)', isAbout: true },
  // One closed path next to one open mention is still about the folder.
  { text: 'ls .agents/local/tmp/; cd .agents', isAbout: true },
  { text: 'ls scripts/agents/a.ts; cp x .agents/$F', isAbout: true },
  // Characters that change length in lower case leave the text as it is.
  { text: 'İ .agents/local/x', isAbout: true },
];

describe('InlineScript.mentionsFolder', () => {
  for (const item of CASES) {
    test(`${item.isAbout ? 'about' : 'not about'}: ${item.text}`, () => {
      expect(InlineScript.mentionsFolder({ text: item.text })).toBe(item.isAbout);
    });
  }
});

describe('InlineScript.withoutClosedPaths', () => {
  test('blanks only the closed path and keeps the rest of the line', () => {
    expect(InlineScript.withoutClosedPaths({ text: 'tail -3 .agents/local/tmp/a.log | wc' })).toBe(
      'tail -3 .  | wc',
    );
  });

  test('a path that holds a piece of the manifest name is kept', () => {
    const text = 'cat .agents/local/vulcan.manifest.json';

    expect(InlineScript.withoutClosedPaths({ text })).toBe(text);
  });

  test('a long run of agents/ components costs time in step with its length', () => {
    const sizes = [20_000, 80_000];
    const times: number[] = [];

    for (const size of sizes) {
      const closed = `${'agents/a'.repeat(size)}`;
      const open = `${'agents/a/'.repeat(size)}$(x)`;
      const broken = `${'agents/a/../'.repeat(size)}`;
      const started = performance.now();

      expect(InlineScript.mentionsFolder({ text: closed })).toBe(false);
      expect(InlineScript.mentionsFolder({ text: open })).toBe(true);
      expect(InlineScript.mentionsFolder({ text: broken })).toBe(true);

      times.push(performance.now() - started);
    }

    expect(times[1] ?? Infinity).toBeLessThan(2000);
    // Four times the text must not cost sixteen times the time.
    expect((times[1] ?? Infinity) / Math.max(times[0] ?? 1, 1)).toBeLessThan(12);
  });
});
