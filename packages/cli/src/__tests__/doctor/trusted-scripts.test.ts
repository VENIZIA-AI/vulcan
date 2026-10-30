import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DoctorChecks, runDoctorNotes, runDoctorWarnings } from '../../doctor/index.ts';
import { git, initRepo } from '../git-repo.helper.ts';
import { isolateOwnerReplySwitch } from '../owner-reply-env.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);
isolateOwnerReplySwitch();

const BODY = "await fetch(url, { method: 'POST' });\nexport {};\n";

const configOf = (opts: { scripts: string[] }): string =>
  `export default { guard: { writes: { trustedScripts: ${JSON.stringify(opts.scripts)} } } };\n`;

/** A committed project whose config lists `scripts`; `committed` are tracked, the rest is made after the commit. */
const project = (opts: { scripts: string[]; committed?: string[] }): string => {
  const files: Record<string, string> = { '.configs/vulcan.config.ts': configOf(opts) };

  for (const script of opts.committed ?? []) {
    files[script] = BODY;
  }

  const root = createProject({ files });

  initRepo({ cwd: root });

  return root;
};

const guardsOf = (opts: { items: { check: string; file?: string; message: string }[] }) =>
  opts.items.filter((item) => item.check === DoctorChecks.GUARDS);

describe('doctor: trusted scripts', () => {
  test('a clean trusted script is listed as a note and is not a warning', async () => {
    const root = project({ scripts: ['tools/cli.ts'], committed: ['tools/cli.ts'] });
    const result = await runDoctorNotes({ root });
    const notes = guardsOf({ items: result });

    expect(notes).toHaveLength(1);
    expect(notes[0].file).toBe('tools/cli.ts');
    expect(notes[0].message).toContain('does not read this script');
    const result2 = await runDoctorWarnings({ root });
    expect(guardsOf({ items: result2 })).toEqual([]);
  });

  test('a missing path warns', async () => {
    const root = project({ scripts: ['tools/typo.ts'] });
    const result = await runDoctorWarnings({ root });
    const warnings = guardsOf({ items: result });

    expect(warnings).toHaveLength(1);
    expect(warnings[0].file).toBe('tools/typo.ts');
    expect(warnings[0].message).toContain('does not exist');
  });

  test('an untracked path warns', async () => {
    const root = project({ scripts: ['tools/cli.ts'] });

    mkdirSync(join(root, 'tools'));
    writeFileSync(join(root, 'tools', 'cli.ts'), BODY);

    const result = await runDoctorWarnings({ root });
    const warnings = guardsOf({ items: result });

    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('not tracked');
  });

  test('an uncommitted path warns', async () => {
    const root = project({ scripts: ['tools/cli.ts'] });

    mkdirSync(join(root, 'tools'));
    writeFileSync(join(root, 'tools', 'cli.ts'), BODY);
    git({ cwd: root, args: ['add', 'tools/cli.ts'] });

    const result = await runDoctorWarnings({ root });
    const warnings = guardsOf({ items: result });

    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('not in the last commit');
  });

  test('a modified script is a note only, not a warning', async () => {
    const root = project({ scripts: ['tools/cli.ts'], committed: ['tools/cli.ts'] });

    writeFileSync(join(root, 'tools', 'cli.ts'), `${BODY}// edited\n`);

    const result = await runDoctorNotes({ root });
    const notes = guardsOf({ items: result });

    expect(notes).toHaveLength(1);
    expect(notes[0].message).toContain('reads it like any script now');
    expect(notes[0].message).toContain('modified trusted script');
    const result2 = await runDoctorWarnings({ root });
    expect(guardsOf({ items: result2 })).toEqual([]);
  });

  test('an empty list adds nothing', async () => {
    const root = project({ scripts: [] });

    const result = await runDoctorNotes({ root });
    expect(guardsOf({ items: result })).toEqual([]);
    const result2 = await runDoctorWarnings({ root });
    expect(guardsOf({ items: result2 })).toEqual([]);
  });

  test('one line per listed script', async () => {
    const root = project({
      scripts: ['a.ts', 'b.ts'],
      committed: ['a.ts'],
    });

    const result = await runDoctorNotes({ root });
    expect(guardsOf({ items: result })).toHaveLength(2);
    const result2 = await runDoctorWarnings({ root });
    expect(guardsOf({ items: result2 })).toHaveLength(1);
  });
});

describe('doctor: read-only subcommands of a trusted script', () => {
  const RELEASE = [
    'const [command] = Bun.argv.slice(2);',
    "if (command === 'plan') console.log('matrix');",
    'if (command === "registry") console.log(\'lookup\');',
    "if (command === 'run') await fetch(url, { method: 'POST' });",
    'export {};',
    '',
  ].join('\n');

  const entryProject = (opts: { readOnly: string[]; committed?: boolean }): string => {
    const config = `export default { guard: { writes: { trustedScripts: [${JSON.stringify({ script: 'tools/release.ts', readOnly: opts.readOnly })}] } } };\n`;
    const root = createProject({
      files: {
        '.configs/vulcan.config.ts': config,
        ...(opts.committed === false ? {} : { 'tools/release.ts': RELEASE }),
      },
    });

    initRepo({ cwd: root });

    return root;
  };

  test('a subcommand the script holds as a quoted string adds no note about it', async () => {
    const root = entryProject({ readOnly: ['plan', 'registry'] });
    const result = await runDoctorNotes({ root });
    const notes = guardsOf({ items: result });

    expect(notes).toHaveLength(1);
    expect(notes[0].file).toBe('tools/release.ts');
    expect(notes[0].message).toContain('plan, registry');
    expect(notes[0].message).toContain('does not read this script');
    const result2 = await runDoctorWarnings({ root });
    expect(guardsOf({ items: result2 })).toEqual([]);
  });

  test('a subcommand the script does not know is a note that says it checks the text, never a warning', async () => {
    const root = entryProject({ readOnly: ['plan', 'regsitry', 'ru'] });
    const result = await runDoctorNotes({ root });
    const notes = guardsOf({ items: result });
    const unknown = notes.filter((note) => note.message.includes('quoted string'));

    expect(unknown).toHaveLength(2);
    expect(unknown[0].file).toBe('tools/release.ts');
    expect(unknown[0].message).toContain("'regsitry'");
    expect(unknown[1].message).toContain("'ru'");
    expect(unknown[0].message).toContain('text of the file');
    expect(unknown[0].message).toContain('not what the script does');
    expect(unknown.some((note) => note.message.includes("'plan'"))).toBe(false);
    const result2 = await runDoctorWarnings({ root });
    expect(guardsOf({ items: result2 })).toEqual([]);
  });

  test('a word inside another word is not a subcommand the script knows', async () => {
    const root = entryProject({ readOnly: ['pla', 'ma'] });
    const result = await runDoctorNotes({ root });
    const unknown = guardsOf({ items: result }).filter((note) =>
      note.message.includes('quoted string'),
    );

    expect(unknown.map((note) => note.message.match(/'(\w+)'/)?.[1])).toEqual(['pla', 'ma']);
  });

  test('a missing script warns once and adds no note about its subcommands', async () => {
    const root = entryProject({ readOnly: ['plan'], committed: false });
    const result = await runDoctorWarnings({ root });
    const warnings = guardsOf({ items: result });
    const result2 = await runDoctorNotes({ root });
    const notes = guardsOf({ items: result2 });

    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('does not exist');
    expect(notes.some((note) => note.message.includes('quoted string'))).toBe(false);
  });

  test('a folder named like the script does not stop doctor and adds no note about subcommands', async () => {
    const root = createProject({
      files: {
        '.configs/vulcan.config.ts': `export default { guard: { writes: { trustedScripts: [{ script: 'tools/release.ts', readOnly: ['plan'] }] } } };\n`,
      },
    });

    mkdirSync(join(root, 'tools', 'release.ts'), { recursive: true });
    initRepo({ cwd: root });

    const result = await runDoctorNotes({ root });
    const notes = guardsOf({ items: result });

    expect(notes.some((note) => note.message.includes('quoted string'))).toBe(false);
  });

  test('a link is not followed to read a file outside the repo', async () => {
    const outside = createProject({ files: { 'target.ts': RELEASE } });
    const root = createProject({
      files: {
        '.configs/vulcan.config.ts': `export default { guard: { writes: { trustedScripts: [{ script: 'tools/release.ts', readOnly: ['nope'] }] } } };\n`,
      },
    });

    mkdirSync(join(root, 'tools'));
    symlinkSync(join(outside, 'target.ts'), join(root, 'tools', 'release.ts'));
    initRepo({ cwd: root });

    const result = await runDoctorNotes({ root });
    const notes = guardsOf({ items: result });

    expect(notes.some((note) => note.message.includes('quoted string'))).toBe(false);
  });

  test('a modified script is a note that says it reads the script like any script now', async () => {
    const root = entryProject({ readOnly: ['plan'] });

    writeFileSync(join(root, 'tools', 'release.ts'), `${RELEASE}// edited\n`);

    const result = await runDoctorNotes({ root });
    const notes = guardsOf({ items: result });

    expect(notes).toHaveLength(1);
    expect(notes[0].message).toContain('reads it like any script now');
    const result2 = await runDoctorWarnings({ root });
    expect(guardsOf({ items: result2 })).toEqual([]);
  });

  test('a path string and an object in one list each give their line', async () => {
    const config = `export default { guard: { writes: { trustedScripts: ['a.ts', { script: 'tools/release.ts', readOnly: ['plan'] }] } } };\n`;
    const root = createProject({
      files: { '.configs/vulcan.config.ts': config, 'a.ts': BODY, 'tools/release.ts': RELEASE },
    });

    initRepo({ cwd: root });

    const result = await runDoctorNotes({ root });
    const notes = guardsOf({ items: result });

    expect(notes.map((note) => note.file)).toEqual(['a.ts', 'tools/release.ts']);
  });
});
