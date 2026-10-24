import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createProject, removeProjects } from '../project.helper.ts';
import { spawnSyncBounded } from '../spawn.helper.ts';

afterAll(removeProjects);

const CLI = join(import.meta.dir, '..', '..', 'cli.ts');
const FILE = '.agents/local/profile.json';
const CONFIG = "export default { name: 'acme', rules: { 'V-W-01': 'on-user-word' } };\n";

/** Runs `vulcan profile ...` with `lines` on stdin, as a pipe: the plain questions, not the menus. */
const profile = (opts: {
  root: string;
  args?: string[];
  lines?: string[];
  env?: Record<string, string>;
}) => {
  const child = spawnSyncBounded({
    cmd: [process.execPath, CLI, 'profile', ...(opts.args ?? [])],
    cwd: opts.root,
    env: { ...process.env, TERM: 'dumb', LANG: 'en_US.UTF-8', ...opts.env },
    stdin: Buffer.from(`${(opts.lines ?? []).join('\n')}\n`),
    stdout: 'pipe',
    stderr: 'pipe',
  });

  return {
    code: child.exitCode ?? 1,
    stdout: child.stdout.toString(),
    stderr: child.stderr.toString(),
  };
};

const project = (): string =>
  createProject({
    files: {
      '.configs/vulcan.config.ts': CONFIG,
      '.gitignore': '.agents/local/\n',
      'package.json': '{}',
    },
  });

// The ten questions in order: language, you, self, formality, tone, detail, ask first, propose commits, about, code taste.
const ANSWERS = [
  '',
  'Sam',
  'I',
  'informal',
  'friendly',
  'headline',
  'y',
  'n',
  'Short answers.',
  'Early returns.',
];

describe('vulcan profile', () => {
  test('asks the questions as plain lines and writes the profile inside the project', () => {
    const root = project();
    const result = profile({ root, lines: ANSWERS });

    expect(result.code).toBe(0);
    expect(result.stderr).toContain('saved .agents/local/profile.json');

    const saved = JSON.parse(readFileSync(join(root, FILE), 'utf8'));

    expect(saved.language).toBe('en');
    expect(saved.address).toEqual({ you: 'Sam', self: 'I', formality: 'informal' });
    expect(saved.tone).toBe('friendly');
    expect(saved.reportDetail).toBe('headline');
    expect(saved.habits).toEqual({ askBeforeReversible: true, proposeCommits: false });
    expect(saved.about).toBe('Short answers.');
  });

  test('every answer left empty takes the default, and the language default is the machine language', () => {
    const root = project();
    const result = profile({
      root,
      // Ten questions and, for a language that is not English, one more: type the report words or keep English.
      lines: Array.from({ length: 11 }, () => ''),
      env: { LANG: 'fr_FR.UTF-8' },
    });

    expect(result.code).toBe(0);
    // French is not English: the form offers the report words; an empty answer keeps English.
    expect(JSON.parse(readFileSync(join(root, FILE), 'utf8')).language).toBe('fr');
  }, 30_000);

  test('an invalid answer is asked again, with the reason', () => {
    const root = project();
    const result = profile({ root, lines: ['constructor', 'en', ...ANSWERS.slice(1)] });

    expect(result.code).toBe(0);
    expect(result.stderr).toContain('a language code such as en or pt-BR');
    expect(JSON.parse(readFileSync(join(root, FILE), 'utf8')).language).toBe('en');
  });

  test('the end of the input cancels: nothing is written', () => {
    const root = project();
    const result = profile({ root, lines: ['en', 'Sam'] });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('cancelled, nothing written');
    expect(existsSync(join(root, FILE))).toBe(false);
  });

  test('without a .gitignore that lists .agents/local/ it refuses to save', () => {
    const root = createProject({
      files: { '.configs/vulcan.config.ts': CONFIG, 'package.json': '{}' },
    });
    const result = profile({ root, lines: ANSWERS });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('does not list .agents/local/');
    expect(existsSync(join(root, FILE))).toBe(false);
  });

  test('run again, the earlier answers are the defaults', () => {
    const root = project();

    expect(profile({ root, lines: ANSWERS }).code).toBe(0);
    expect(profile({ root, lines: Array.from({ length: 10 }, () => '') }).code).toBe(0);

    const saved = JSON.parse(readFileSync(join(root, FILE), 'utf8'));

    expect(saved.address.you).toBe('Sam');
    expect(saved.tone).toBe('friendly');
    expect(saved.about).toBe('Short answers.');
  });

  test('show prints the file, or says there is none; edit is the form again', () => {
    const root = project();

    expect(profile({ root, args: ['show'] }).stderr).toContain('none yet');

    profile({ root, lines: ANSWERS });

    const shown = profile({ root, args: ['show'] });

    expect(shown.code).toBe(0);
    expect(JSON.parse(shown.stdout).address.you).toBe('Sam');
    expect(
      profile({ root, args: ['edit'], lines: Array.from({ length: 10 }, () => '') }).code,
    ).toBe(0);
  });

  test('reset is a dry run until --yes, and removes only the profile', () => {
    const root = project();

    profile({ root, lines: ANSWERS });
    mkdirSync(join(root, '.agents/local/reports'), { recursive: true });
    writeFileSync(join(root, '.agents/local/reports/r.md'), 'keep');

    const dry = profile({ root, args: ['reset'] });

    expect(dry.stderr).toContain('would delete');
    expect(existsSync(join(root, FILE))).toBe(true);
    expect(profile({ root, args: ['reset', '--yes'] }).stderr).toContain('deleted');
    expect(existsSync(join(root, FILE))).toBe(false);
    expect(readFileSync(join(root, '.agents/local/reports/r.md'), 'utf8')).toBe('keep');
    expect(profile({ root, args: ['reset', '--yes'] }).stderr).toContain('nothing to reset');
  });

  test('a broken profile is named, and reset is the way out', () => {
    const root = project();

    mkdirSync(join(root, '.agents/local'), { recursive: true });
    writeFileSync(join(root, FILE), '{ nope');

    const result = profile({ root, lines: ANSWERS });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('is not valid JSON');
    expect(result.stderr).toContain('vulcan profile reset --yes');
  });

  test('an unknown argument is refused', () => {
    expect(profile({ root: project(), args: ['wipe'] }).code).toBe(1);
  });
});
