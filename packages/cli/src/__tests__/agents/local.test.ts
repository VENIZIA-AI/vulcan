import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL_AGENTS_FILE, readLocalChoice, renderLocalChoice } from '../../agents/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

describe('the local choice file', () => {
  test('lives next to the manifest and is named once', () => {
    expect(LOCAL_AGENTS_FILE).toBe('.agents/vulcan.local.json');
  });

  test('renders a generated note, the schema version and the agents', () => {
    expect(JSON.parse(renderLocalChoice({ agents: ['claude', 'omp'] }))).toEqual({
      $generated: 'by vulcan sync - your agents on this machine; not committed',
      schemaVersion: 1,
      agents: ['claude', 'omp'],
    });
    expect(renderLocalChoice({ agents: [] }).endsWith('\n')).toBe(true);
  });

  test('absent reads as no choice', () => {
    expect(readLocalChoice({ root: createProject({ files: {} }) })).toEqual({
      ok: true,
      agents: undefined,
    });
  });

  test('a written file reads back, an empty list included', () => {
    const root = createProject({ files: {} });

    mkdirSync(join(root, '.agents'));

    for (const agents of [['claude'], ['omp', 'pi'], []]) {
      const file = join(root, LOCAL_AGENTS_FILE);

      writeFileSync(file, renderLocalChoice({ agents }));
      expect(existsSync(file)).toBe(true);
      expect(readLocalChoice({ root })).toEqual({ ok: true, agents });
    }
  });

  test('a file that is not JSON, or names an unknown agent, is an error that says how to fix it', () => {
    const broken = createProject({ files: { [LOCAL_AGENTS_FILE]: '{ nope' } });
    const unknown = createProject({
      files: {
        [LOCAL_AGENTS_FILE]: JSON.stringify({ schemaVersion: 1, agents: ['claude', 'vim'] }),
      },
    });

    expect(readLocalChoice({ root: broken })).toEqual({
      ok: false,
      error: `${LOCAL_AGENTS_FILE} is not valid JSON - delete it and run: vulcan sync --agents <list>`,
    });

    const result = readLocalChoice({ root: unknown });

    expect(!result.ok && result.error).toContain("unknown agent 'vim'");
    expect(readFileSync(join(unknown, LOCAL_AGENTS_FILE), 'utf8')).toContain('vim');
  });
});
