import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectAgents } from '../../agents/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

/** A fake PATH holding executables with these names, a fake home with these folders, a project with these folders. */
const world = (opts: { binaries?: string[]; homeDirs?: string[]; projectDirs?: string[] }) => {
  const bin = createProject({ files: {} });
  const home = createProject({ files: {} });
  const root = createProject({ files: {} });

  for (const name of opts.binaries ?? []) {
    writeFileSync(join(bin, name), '#!/bin/sh\nexit 0\n');
    chmodSync(join(bin, name), 0o755);
  }

  for (const directory of opts.homeDirs ?? []) {
    mkdirSync(join(home, directory), { recursive: true });
  }

  for (const directory of opts.projectDirs ?? []) {
    mkdirSync(join(root, directory), { recursive: true });
  }

  return { root, home, path: bin };
};

describe('detectAgents', () => {
  test('nothing installed, nothing detected', () => {
    expect(detectAgents(world({}))).toEqual([]);
  });

  test('a binary on PATH', () => {
    expect(detectAgents(world({ binaries: ['omp', 'codex'] }))).toEqual(['omp', 'codex']);
  });

  test('a folder in the home', () => {
    expect(detectAgents(world({ homeDirs: ['.claude', '.codex'] }))).toEqual(['claude', 'codex']);
  });

  test('a folder in the project', () => {
    expect(detectAgents(world({ projectDirs: ['.cursor', '.pi'] }))).toEqual(['cursor', 'pi']);
  });

  test('Antigravity is its binary agy or its CLI folder', () => {
    expect(detectAgents(world({ binaries: ['agy'] }))).toEqual(['antigravity']);
    expect(detectAgents(world({ homeDirs: ['.gemini/antigravity-cli'] }))).toEqual(['antigravity']);
    expect(detectAgents(world({ homeDirs: ['.gemini'] }))).toEqual([]);
  });

  test('~/.copilot alone is not Copilot CLI, the copilot binary is', () => {
    expect(detectAgents(world({ homeDirs: ['.copilot'] }))).toEqual([]);
    expect(detectAgents(world({ binaries: ['copilot'] }))).toEqual(['copilot-cli']);
  });

  test('Copilot in VS Code is its extension folder, found by pattern', () => {
    expect(
      detectAgents(world({ homeDirs: ['.vscode/extensions/github.copilot-chat-0.31.0'] })),
    ).toEqual(['copilot-vscode']);
    expect(detectAgents(world({ homeDirs: ['.vscode/extensions/ms-python.python-1.0'] }))).toEqual(
      [],
    );
  });

  test('the order is the table order, whatever the signals', () => {
    expect(
      detectAgents(
        world({ binaries: ['pi', 'agy'], homeDirs: ['.claude'], projectDirs: ['.cursor'] }),
      ),
    ).toEqual(['claude', 'cursor', 'antigravity', 'pi']);
  });
});
