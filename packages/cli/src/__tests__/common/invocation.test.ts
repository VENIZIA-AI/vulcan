import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_DIRECTORY, ProjectLayout } from '../../common/index.ts';

test('the invocation VULCAN prints runs the linked bin and never fetches a package: bun run vulcan', () => {
  expect(ProjectLayout.VULCAN_COMMAND).toBe('bun run vulcan');
});

test('the shipped make module runs the linked bin by path, which never falls back to $PATH', () => {
  const makefile = readFileSync(join(BASE_DIRECTORY, 'make', 'vulcan.mk'), 'utf8');

  expect(makefile).toContain('VULCAN ?= bun $(CURDIR)/node_modules/.bin/vulcan');
  expect(makefile).not.toContain('VULCAN ?= bun run');
});

test('the AGENTS.md template tells agents the linked-bin form, never a bunx form', () => {
  const template = readFileSync(join(BASE_DIRECTORY, 'templates', 'AGENTS.md'), 'utf8');

  expect(template).not.toMatch(/\bbun x |\bbunx |\bnpx /);
  expect(template).toContain(ProjectLayout.VULCAN_COMMAND);
});

test('the Makefile include tolerates a fresh clone where node_modules does not exist yet', () => {
  expect(ProjectLayout.MAKE_INCLUDE_LINE).toBe(
    '-include node_modules/@venizia/vulcan/base/make/vulcan.mk',
  );
});
