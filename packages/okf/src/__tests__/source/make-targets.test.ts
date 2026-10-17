import { afterAll, afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectMakefileTargets } from '../../source/collectors.ts';
import { clearProjectConfig, useProjectConfig } from '../project.helper.ts';

const roots: string[] = [];

afterEach(clearProjectConfig);

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** A project whose Makefile includes a shipped module, the way a project includes vulcan.mk. */
const makeProject = (opts: { files: Record<string, string> }): string => {
  const root = mkdtempSync(join(tmpdir(), 'okf-make-targets-'));

  roots.push(root);

  for (const [path, content] of Object.entries(opts.files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), content);
  }

  useProjectConfig({ root, config: {} });

  return root;
};

const descriptionOf = (opts: { name: string }): string | undefined =>
  collectMakefileTargets().find(target => target.name === opts.name)?.description;

test("an included module's targets carry their ## descriptions", () => {
  makeProject({
    files: {
      Makefile: 'include shipped/vulcan.mk\n\nbuild:\n\t@true\n',
      'shipped/vulcan.mk':
        'vulcan-sync: ## Write the agent adapters from the config\n\t@true\n\nokf-gen: vulcan-sync ## Regenerate the knowledge bundle\n\t@true\n',
    },
  });

  expect(descriptionOf({ name: 'vulcan-sync' })).toBe('Write the agent adapters from the config');
  expect(descriptionOf({ name: 'okf-gen' })).toBe('Regenerate the knowledge bundle');
  expect(descriptionOf({ name: 'build' })).toBe('');
});

test('a make/help.mk row wins over a ## description, so a project can reword a shipped target', () => {
  makeProject({
    files: {
      Makefile: 'include shipped/vulcan.mk\n',
      'shipped/vulcan.mk': 'vulcan-sync: ## Shipped words\n\t@true\n',
      'make/help.mk': 'help:\n\t@printf $(HELP_ROW) "vulcan-sync" "The project\'s words"\n',
    },
  });

  expect(descriptionOf({ name: 'vulcan-sync' })).toBe("The project's words");
});
