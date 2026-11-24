import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VersionNotes } from '@/changelogs/notes';
import { runChangelogsCommand } from '@/migrations';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const LOG = `---
title: 0.4.8
version: 0.4.8
packages: ['@a/kernel']
released: 2026-11-20
---
The 0.4.8 line.

## Breaking
- **Factory only** \`thing-factory\`: call the factory.
`;

const MIGRATION = `thing-factory:
  symbols: [Thing.make]
  upgrade: { before: "Thing.make()", after: "ThingFactory.build()" }
  downgrade: { steps: ["Use Thing.make() again"] }
`;

describe('VersionNotes', () => {
  test('the notes are the body of log.md without its front matter, then the packages', () => {
    const notes = VersionNotes.notesOf({
      log: LOG,
      names: ['@a/kernel', '@a/web'],
      version: '0.4.8',
    });

    expect(notes).toBe(`The 0.4.8 line.

## Breaking
- **Factory only** \`thing-factory\`: call the factory.

## Packages

- [@a/kernel@0.4.8](https://www.npmjs.com/package/@a/kernel/v/0.4.8)
- [@a/web@0.4.8](https://www.npmjs.com/package/@a/web/v/0.4.8)
`);
  });

  test('a log with no body says there is no change for users', () => {
    const notes = VersionNotes.notesOf({
      log: '---\ntitle: 0.4.8\n---\n',
      names: ['@a/kernel'],
      version: '0.4.8',
    });

    expect(notes.startsWith(VersionNotes.NO_USER_CHANGES)).toBe(true);
  });

  test('C13: an absent migration.yaml, an empty one and {} hold no block; one with an id does', () => {
    expect(VersionNotes.hasBlocks({})).toBe(false);
    expect(VersionNotes.hasBlocks({ migration: '' })).toBe(false);
    expect(VersionNotes.hasBlocks({ migration: '{}\n' })).toBe(false);
    expect(VersionNotes.hasBlocks({ migration: '# nothing\n' })).toBe(false);
    expect(VersionNotes.hasBlocks({ migration: MIGRATION })).toBe(true);
  });
});

describe('vulcan migrate notes', () => {
  let root = '';
  let out = '';
  let err = '';
  const spies: { mockRestore: () => void }[] = [];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'atlas-notes-'));
    roots.push(root);
    mkdirSync(join(root, '.agents'), { recursive: true });
    mkdirSync(join(root, 'changes', '0.4.8'), { recursive: true });
    mkdirSync(join(root, 'changes', '0.4.9'), { recursive: true });
    writeFileSync(
      join(root, '.agents', 'vulcan.manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        packages: [
          { name: '@a/kernel', dir: 'kernel', aliases: [], retired: false },
          { name: '@a/old', dir: 'old', aliases: [], retired: true },
        ],
        knowledge: { changelogs: 'changes' },
        release: { tagPattern: '<dir>-v<version>', ignoreTags: [] },
      }),
    );
    writeFileSync(join(root, 'changes', '0.4.8', 'log.md'), LOG);
    writeFileSync(join(root, 'changes', '0.4.8', 'migration.yaml'), MIGRATION);
    writeFileSync(join(root, 'changes', '0.4.9', 'log.md'), LOG.replace('0.4.8', '0.4.9'));
    writeFileSync(join(root, 'changes', '0.4.9', 'migration.yaml'), '{}\n');
    process.env.VULCAN_PROJECT_ROOT = root;
    out = '';
    err = '';
    spies.push(
      spyOn(process.stdout, 'write').mockImplementation((text) => {
        out += String(text);

        return true;
      }),
      spyOn(console, 'error').mockImplementation((text) => {
        err += `${String(text)}\n`;
      }),
    );
  });

  afterEach(() => {
    for (const spy of spies.splice(0)) {
      spy.mockRestore();
    }

    delete process.env.VULCAN_PROJECT_ROOT;
  });

  test('prints the notes with the live packages at the version', () => {
    const code = runChangelogsCommand({ command: 'notes', args: ['--version', '0.4.8'] });

    expect(code).toBe(0);
    expect(out).toContain('The 0.4.8 line.');
    expect(out).toContain('[@a/kernel@0.4.8]');
    expect(out).not.toContain('@a/old');
  });

  test('--migration prints the path of migration.yaml when it holds a block, and nothing when it does not', () => {
    expect(
      runChangelogsCommand({ command: 'notes', args: ['--version', '0.4.8', '--migration'] }),
    ).toBe(0);
    expect(out.trim()).toBe(join(root, 'changes', '0.4.8', 'migration.yaml'));

    out = '';

    expect(
      runChangelogsCommand({ command: 'notes', args: ['--version', '0.4.9', '--migration'] }),
    ).toBe(0);
    expect(out).toBe('');
  });

  test('a version with no folder exits 1 and a malformed request exits 2', () => {
    expect(runChangelogsCommand({ command: 'notes', args: ['--version', '0.4.1'] })).toBe(1);
    expect(err).toContain('no changelogs/0.4.1/log.md');
    expect(runChangelogsCommand({ command: 'notes', args: ['--version', 'latest'] })).toBe(2);
    expect(runChangelogsCommand({ command: 'notes', args: [] })).toBe(2);
  });
});
