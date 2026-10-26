import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
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
    const notes = guardsOf({ items: await runDoctorNotes({ root }) });

    expect(notes).toHaveLength(1);
    expect(notes[0].file).toBe('tools/cli.ts');
    expect(notes[0].message).toContain('does not read this script');
    expect(guardsOf({ items: await runDoctorWarnings({ root }) })).toEqual([]);
  });

  test('a missing path warns', async () => {
    const root = project({ scripts: ['tools/typo.ts'] });
    const warnings = guardsOf({ items: await runDoctorWarnings({ root }) });

    expect(warnings).toHaveLength(1);
    expect(warnings[0].file).toBe('tools/typo.ts');
    expect(warnings[0].message).toContain('does not exist');
  });

  test('an untracked path warns', async () => {
    const root = project({ scripts: ['tools/cli.ts'] });

    mkdirSync(join(root, 'tools'));
    writeFileSync(join(root, 'tools', 'cli.ts'), BODY);

    const warnings = guardsOf({ items: await runDoctorWarnings({ root }) });

    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('not tracked');
  });

  test('an uncommitted path warns', async () => {
    const root = project({ scripts: ['tools/cli.ts'] });

    mkdirSync(join(root, 'tools'));
    writeFileSync(join(root, 'tools', 'cli.ts'), BODY);
    git({ cwd: root, args: ['add', 'tools/cli.ts'] });

    const warnings = guardsOf({ items: await runDoctorWarnings({ root }) });

    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('not in the last commit');
  });

  test('a modified script is a note only, not a warning', async () => {
    const root = project({ scripts: ['tools/cli.ts'], committed: ['tools/cli.ts'] });

    writeFileSync(join(root, 'tools', 'cli.ts'), `${BODY}// edited\n`);

    const notes = guardsOf({ items: await runDoctorNotes({ root }) });

    expect(notes).toHaveLength(1);
    expect(notes[0].message).toContain('reads it like any script now');
    expect(notes[0].message).toContain('modified trusted script');
    expect(guardsOf({ items: await runDoctorWarnings({ root }) })).toEqual([]);
  });

  test('an empty list adds nothing', async () => {
    const root = project({ scripts: [] });

    expect(guardsOf({ items: await runDoctorNotes({ root }) })).toEqual([]);
    expect(guardsOf({ items: await runDoctorWarnings({ root }) })).toEqual([]);
  });

  test('one line per listed script', async () => {
    const root = project({
      scripts: ['a.ts', 'b.ts'],
      committed: ['a.ts'],
    });

    expect(guardsOf({ items: await runDoctorNotes({ root }) })).toHaveLength(2);
    expect(guardsOf({ items: await runDoctorWarnings({ root }) })).toHaveLength(1);
  });
});
