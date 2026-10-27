import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';

const CLI = join(import.meta.dir, '..', '..', 'cli.ts');

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const PAGE = (title: string): string =>
  `---\ntype: Reference\ntitle: ${title}\ndescription: ${title}.\n---\n\n# ${title}\n`;

/** A project with a Makefile and the given okf config; `concepts` are extra bundle files. */
const makeProject = (opts: { okf: object; concepts?: Record<string, string> }) => {
  const root = mkdtempSync(join(tmpdir(), 'okf-see-also-'));

  roots.push(root);
  mkdirSync(join(root, '.agents', 'knowledge'), { recursive: true });
  writeFileSync(
    join(root, '.agents', 'knowledge', 'index.md'),
    '---\nokf_version: "0.2"\n---\n\n# Knowledge\n',
  );
  writeFileSync(join(root, 'Makefile'), 'build: ## Build it\n\t@echo build\n');

  for (const [path, content] of Object.entries(opts.concepts ?? {})) {
    mkdirSync(join(root, '.agents', 'knowledge', path, '..'), { recursive: true });
    writeFileSync(join(root, '.agents', 'knowledge', path), content);
  }

  const run = (args: string[]) => {
    const child = spawnSyncBounded({
      cmd: [process.execPath, CLI, ...args],
      env: {
        ...process.env,
        VULCAN_CONFIG: JSON.stringify({ okf: opts.okf }),
        VULCAN_PROJECT_ROOT: root,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stdout = child.stdout.toString();
    const stderr = child.stderr.toString();

    return { code: child.exitCode, stdout, stderr, output: stdout + stderr };
  };

  return { root, run };
};

const PAGE_PATH = ['.agents', 'knowledge', 'reference', 'makefile-targets.md'];

describe('the default seeAlso of a built-in renderer', () => {
  test('is left out while the concept it points at does not exist: the page passes check --strict', () => {
    const project = makeProject({ okf: { renderers: ['makefile-targets'] } });

    expect(project.run(['gen']).code).toBe(0);

    const page = readFileSync(join(project.root, ...PAGE_PATH), 'utf8');

    expect(page).not.toContain('build-system');
    expect(page).toContain('> Generated from source - do not edit; run `make okf-gen`.\n');

    const check = project.run(['check', '--strict']);

    expect(check.output).not.toContain('broken link');
    expect(check.code).toBe(0);
  });

  test('links the concept once it exists', () => {
    const project = makeProject({
      okf: { renderers: ['makefile-targets'] },
      concepts: { 'process/build-system.md': PAGE('Build system') },
    });

    expect(project.run(['gen']).code).toBe(0);
    expect(readFileSync(join(project.root, ...PAGE_PATH), 'utf8')).toContain(
      'Playbook: [build system](/process/build-system.md).',
    );
  });

  test('an explicit seeAlso option is written as given, concept or not', () => {
    const project = makeProject({
      okf: { renderers: [{ id: 'makefile-targets', options: { seeAlso: 'See the wiki.' } }] },
    });

    project.run(['gen']);
    expect(readFileSync(join(project.root, ...PAGE_PATH), 'utf8')).toContain(
      'run `make okf-gen`. See the wiki.\n',
    );
  });
});

describe('gen with nothing configured', () => {
  test('names the keys to set and the built-in renderers', () => {
    const result = makeProject({ okf: {} }).run(['gen']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('okf.renderers');
    expect(result.stdout).toContain('source-map, makefile-targets, binding-keys, packages-table');
  });
});
