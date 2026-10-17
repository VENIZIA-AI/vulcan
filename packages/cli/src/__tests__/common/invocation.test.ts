import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_DIRECTORY, ProjectLayout } from '../../common/index.ts';

test('the unattended invocation never downloads: bun x --no-install vulcan', () => {
  expect(ProjectLayout.VULCAN_COMMAND).toBe('bun x --no-install vulcan');
});

test('the shipped make module runs vulcan without installing anything', () => {
  const makefile = readFileSync(join(BASE_DIRECTORY, 'make', 'vulcan.mk'), 'utf8');

  expect(makefile).toContain(`VULCAN ?= ${ProjectLayout.VULCAN_COMMAND}`);
});

test('the AGENTS.md template tells agents the no-install form', () => {
  const template = readFileSync(join(BASE_DIRECTORY, 'templates', 'AGENTS.md'), 'utf8');

  expect(template).not.toMatch(/bun x vulcan /);
  expect(template).toContain(ProjectLayout.VULCAN_COMMAND);
});

test('the Makefile include tolerates a fresh clone where node_modules does not exist yet', () => {
  expect(ProjectLayout.MAKE_INCLUDE_LINE).toBe(
    '-include node_modules/@venizia/vulcan/base/make/vulcan.mk',
  );
});
