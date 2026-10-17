import { afterEach, expect, test } from 'bun:test';
import { join } from 'node:path';
import { createRenderContext } from '../../generate/define.ts';
import { clearProjectConfig, useProjectConfig } from '../project.helper.ts';

afterEach(clearProjectConfig);

const ROOT = join(import.meta.dir, '..', 'fixtures', 'sources');

const contextOf = () => {
  useProjectConfig({ root: ROOT, config: {} });

  return createRenderContext({ options: {} });
};

test('exportedClasses groups by the configured dir, recursive, abstract included, no .d.ts', () => {
  const classes = contextOf().source.exportedClasses({
    dirs: ['packages/admin/src/providers', 'packages/admin/src/missing'],
    suffix: 'Provider',
  });

  expect(classes).toEqual([
    {
      dir: 'packages/admin/src/providers',
      classes: ['AuthProvider', 'BaseProvider', 'ZetaProvider'],
    },
  ]);
});

test('exportedNames takes capture group 1 of the given pattern, per configured dir', () => {
  const names = contextOf().source.exportedNames({
    dirs: ['packages/react/src/hooks'],
    pattern: /export\s+(?:const|function)\s+(use[A-Z]\w*)/,
  });

  expect(names).toEqual([{ dir: 'packages/react/src/hooks', names: ['useAlpha', 'useBeta'] }]);
});

test('page.header and page.note write the generated-file frame', () => {
  const { page } = contextOf();

  expect(
    page.header({ title: 'T', description: 'D', resource: 'packages', tags: ['reference', 'x'] }),
  ).toBe(
    '---\ntype: Reference\ntitle: T\ndescription: D\nresource: packages\ntags: [reference, x]\ngenerated:\n  by: process:okf-gen\n---\n\n',
  );
  expect(page.note({ seeAlso: 'See [x](/x.md).' })).toBe(
    '> Generated from source - do not edit; run `make okf-gen`. See [x](/x.md).\n\n',
  );
});
