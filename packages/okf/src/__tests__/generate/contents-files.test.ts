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

  expect(collectContentsProblems()).toEqual([
    'contents: .agents/knowledge/overview/long.md has no fresh contents list - run `vulcan x okf gen`',
    'contents: AGENTS.md has no fresh contents list - run `vulcan x okf gen`',
  ]);
});

test('gen writes the lists, then the check passes; a generated reference file is left alone', () => {
  const root = project();

  expect(writeContents()).toEqual(['.agents/knowledge/overview/long.md', 'AGENTS.md']);
  expect(collectContentsProblems()).toEqual([]);
  expect(readFileSync(join(root, '.agents/knowledge/reference/gen.md'), 'utf8')).toBe(GENERATED);
  expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toContain(
    '<!-- okf:generated:contents start -->',
  );
});

test("another generator's page (atlas surface) and the append-only log.md get no contents list", () => {
  const root = project();
  const surface = long({
    head: '---\ntype: Reference\ntitle: Public surface\ngenerated:\n  by: atlas-surface\n---\n',
  });
  const log = long({ head: '# Knowledge log\n\n## 2026-10-17 - an entry\n' });

  writeFileSync(join(root, '.agents/knowledge/reference/public-surface.md'), surface);
  writeFileSync(join(root, '.agents/knowledge/log.md'), log);

  expect(writeContents()).toEqual(['.agents/knowledge/overview/long.md', 'AGENTS.md']);
  expect(collectContentsProblems()).toEqual([]);
  expect(readFileSync(join(root, '.agents/knowledge/reference/public-surface.md'), 'utf8')).toBe(
    surface,
  );
  expect(readFileSync(join(root, '.agents/knowledge/log.md'), 'utf8')).toBe(log);
});
