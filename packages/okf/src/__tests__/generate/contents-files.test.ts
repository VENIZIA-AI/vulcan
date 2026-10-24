import { afterAll, afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectContentsProblems, writeContents } from '../../generate/contents-files.ts';
import { clearProjectConfig, useProjectConfig } from '../project.helper.ts';

afterEach(clearProjectConfig);

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const long = (opts: { head: string }): string =>
  `${opts.head}\n## Part\n\n${Array.from({ length: 110 }, (_unused, index) => `Line ${index}.`).join('\n')}\n`;

const GENERATED = long({
  head: '---\ntype: Reference\ntitle: Gen\ngenerated:\n  by: process:okf-gen\n---\n',
});

const project = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'okf-contents-'));

  roots.push(root);
  mkdirSync(join(root, '.agents/knowledge/overview'), { recursive: true });
  mkdirSync(join(root, '.agents/knowledge/reference'), { recursive: true });
  writeFileSync(
    join(root, '.agents/knowledge/overview/long.md'),
    long({ head: '---\ntype: Concept\ntitle: Long\n---\n\n# Long\n' }),
  );
  writeFileSync(
    join(root, '.agents/knowledge/overview/short.md'),
    '---\ntype: Concept\ntitle: Short\n---\n\nShort.\n',
  );
  writeFileSync(join(root, '.agents/knowledge/reference/gen.md'), GENERATED);
  writeFileSync(join(root, 'AGENTS.md'), long({ head: '# AGENTS.md\n' }));
  useProjectConfig({ root, config: {} });

  return root;
};

test('every long agent-read file without a fresh contents list is a problem (positive control)', () => {
  project();

  expect(collectContentsProblems({ skip: new Set() })).toEqual([
    'contents: .agents/knowledge/overview/long.md has no fresh contents list - run `vulcan x okf gen`',
    'contents: AGENTS.md has no fresh contents list - run `vulcan x okf gen`',
  ]);
});

test('gen writes the lists, then the check passes; a generated reference file is left alone', () => {
  const root = project();

  expect(writeContents({ skip: new Set() })).toEqual([
    '.agents/knowledge/overview/long.md',
    'AGENTS.md',
  ]);
  expect(collectContentsProblems({ skip: new Set() })).toEqual([]);
  expect(readFileSync(join(root, '.agents/knowledge/reference/gen.md'), 'utf8')).toBe(GENERATED);
  expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toContain(
    '<!-- okf:generated:contents start -->',
  );
});

test("another generator's page (atlas surface) and the append-only log.md get no contents list", () => {
  const root = project();
  const surface = long({
    head: '---\ntype: Reference\ntitle: Public surface\ngenerated:\n  by: process:atlas-surface\n---\n',
  });
  const log = long({ head: '# Knowledge log\n\n## 2026-10-17 - an entry\n' });

  writeFileSync(join(root, '.agents/knowledge/reference/public-surface.md'), surface);
  writeFileSync(join(root, '.agents/knowledge/log.md'), log);

  expect(writeContents({ skip: new Set() })).toEqual([
    '.agents/knowledge/overview/long.md',
    'AGENTS.md',
  ]);
  expect(collectContentsProblems({ skip: new Set() })).toEqual([]);
  expect(readFileSync(join(root, '.agents/knowledge/reference/public-surface.md'), 'utf8')).toBe(
    surface,
  );
  expect(readFileSync(join(root, '.agents/knowledge/log.md'), 'utf8')).toBe(log);
});

test("a CRLF generated page is still its generator's, and a body that quotes generated: is not", () => {
  const root = project();
  const crlfGenerated = GENERATED.replace(/\n/g, '\r\n');
  const quoting = long({
    head: '---\ntype: Concept\ntitle: Quoting\n---\n\n# Quoting\n\n```yaml\ngenerated:\n  by: process:okf-gen\n```\n\n---\n',
  });

  writeFileSync(join(root, '.agents/knowledge/reference/gen.md'), crlfGenerated);
  writeFileSync(join(root, '.agents/knowledge/overview/quoting.md'), quoting);

  const written = writeContents({ skip: new Set() });

  expect(written).toContain('.agents/knowledge/overview/quoting.md');
  expect(written).not.toContain('.agents/knowledge/reference/gen.md');
  expect(readFileSync(join(root, '.agents/knowledge/reference/gen.md'), 'utf8')).toBe(
    crlfGenerated,
  );
});

test('okf.contents.files takes globs: every match gets a list, a literal still works, a glob matching nothing is skipped', () => {
  const root = project();

  for (const skill of ['alpha', 'beta']) {
    mkdirSync(join(root, `.agents/skills/${skill}`), { recursive: true });
    writeFileSync(join(root, `.agents/skills/${skill}/SKILL.md`), long({ head: `# ${skill}\n` }));
  }

  useProjectConfig({
    root,
    config: {
      okf: { contents: { files: ['AGENTS.md', '.agents/skills/*/SKILL.md', 'nothing/*.md'] } },
    },
  });

  expect(
    collectContentsProblems({ skip: new Set() }).filter((problem) => problem.includes('SKILL.md')),
  ).toEqual([
    'contents: .agents/skills/alpha/SKILL.md has no fresh contents list - run `vulcan x okf gen`',
    'contents: .agents/skills/beta/SKILL.md has no fresh contents list - run `vulcan x okf gen`',
  ]);
  expect(writeContents({ skip: new Set() })).toContain('.agents/skills/beta/SKILL.md');
  expect(collectContentsProblems({ skip: new Set() })).toEqual([]);
});

test('a file named by both a glob and a literal path is listed once', () => {
  const root = project();

  useProjectConfig({
    root,
    config: { okf: { contents: { files: ['AGENTS.md', '*.md'] } } },
  });

  expect(
    collectContentsProblems({ skip: new Set() }).filter((problem) => problem.includes('AGENTS.md')),
  ).toHaveLength(1);
});
