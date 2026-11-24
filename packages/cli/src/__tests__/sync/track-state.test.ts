import { afterAll, describe, expect, test } from 'bun:test';
import { AgentFiles } from '../../sync/agent-files.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

describe('AgentFiles.trackState', () => {
  test('tracked on exit 0, untracked on exit 1, and unknown when git fails', () => {
    const root = createProject({ files: { 'a.txt': 'a\n', 'b.txt': 'b\n' } });
    const none = createProject({ files: { 'a.txt': 'a\n' } });

    Bun.spawnSync(['git', 'init', '-q'], { cwd: root });
    Bun.spawnSync(['git', 'add', 'a.txt'], { cwd: root });

    expect(AgentFiles.trackState({ root, path: 'a.txt' })).toBe('tracked');
    expect(AgentFiles.trackState({ root, path: 'b.txt' })).toBe('untracked');
    // Not a repository: git answers 128, which is no reason to delete anything.
    expect(AgentFiles.trackState({ root: none, path: 'a.txt' })).toBe('unknown');
    expect(AgentFiles.isTracked({ root: none, path: 'a.txt' })).toBe(false);
  });
});
