import { afterAll, describe, expect, test } from 'bun:test';
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { BoardWatch } from '../../board/watch.ts';
import { EventImport, EventLog, EventStoreConstants } from '../../events/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const NOW = Date.parse('2026-11-03T09:30:00.000Z');
const eventOf = (summary: string, now = NOW) =>
  EventLog.build({ type: 'commit', actor: 'a', source: 'cli', summary, now });
const lineOf = (summary: string, now = NOW): string => JSON.stringify(eventOf(summary, now));
const dirWith = (files: Record<string, string>): string => createProject({ files });
const summaries = (dir: string) => EventLog.read({ dir }).events.map((event) => event.summary);

describe('the log is the database', () => {
  test('an appended event is read back, and no day file is written', () => {
    const dir = dirWith({});

    expect(EventLog.append({ dir, event: eventOf('here') })).toBe(
      join(dir, EventStoreConstants.FILE),
    );
    expect(summaries(dir)).toEqual(['here']);
    expect([...new Bun.Glob('*.jsonl').scanSync({ cwd: dir })]).toEqual([]);
  });

  test('a day file is not read', () => {
    expect(summaries(dirWith({ '2026-11-03.jsonl': `${lineOf('old')}\n` }))).toEqual([]);
  });
});

describe('EventImport', () => {
  const old = (): string =>
    dirWith({
      '2026-11-02.jsonl': `${lineOf('monday', NOW - 86_400_000)}\nnot an event\n\n`,
      // A line of a release before 0.5.0 names its type \`kind\`.
      '2026-11-03.jsonl': `${lineOf('tuesday').replace('"type":', '"kind":')}\n`,
      'notes.jsonl': `${lineOf('not a day file')}\n`,
    });

  test('loads the day files in order, counts what it could not, and leaves the files as they are', () => {
    const dir = old();
    const before = readFileSync(join(dir, '2026-11-03.jsonl'), 'utf8');

    expect(EventImport.run({ dir })).toEqual({ files: 2, added: 2, present: 0, skipped: 1 });
    expect(summaries(dir)).toEqual(['monday', 'tuesday']);
    expect(readFileSync(join(dir, '2026-11-03.jsonl'), 'utf8')).toBe(before);
  });

  test('a second run adds nothing; a line written since is the only new one', () => {
    const dir = old();

    expect(EventImport.pending({ dir })).toBe(2);
    EventImport.run({ dir });
    expect(EventImport.pending({ dir })).toBe(0);

    expect(EventImport.run({ dir })).toEqual({ files: 2, added: 0, present: 2, skipped: 1 });

    appendFileSync(join(dir, '2026-11-03.jsonl'), `${lineOf('late', NOW + 1)}\n`);

    expect(EventImport.pending({ dir })).toBe(1);
    expect(EventImport.run({ dir }).added).toBe(1);
    expect(EventImport.pending({ dir })).toBe(0);
  });

  test('what is pending is told by the files, without reading them', () => {
    const dir = old();
    const file = join(dir, '2026-11-03.jsonl');
    const then = new Date(NOW);

    utimesSync(file, then, then);
    EventImport.run({ dir });
    // The same size and time: the file counts as loaded, whatever it holds.
    writeFileSync(file, 'x'.repeat(statSync(file).size));
    utimesSync(file, then, then);

    expect(EventImport.pending({ dir })).toBe(0);
  });

  test('a folder with no day file has nothing to load, and gets no database', () => {
    const dir = dirWith({});

    expect(EventImport.run({ dir })).toEqual({ files: 0, added: 0, present: 0, skipped: 0 });
    expect(EventImport.pending({ dir })).toBe(0);
    expect(EventLog.read({ dir }).events).toEqual([]);
    expect([...new Bun.Glob('*').scanSync({ cwd: dir })]).toEqual([]);
  });

  test('vulcan event import says what it did', () => {
    const dir = old();
    const run = runCli({ args: ['event', 'import', '--dir', dir], cwd: dir });

    expect(run.code, run.stderr).toBe(0);
    expect(run.stdout).toBe(
      `event: 2 new event(s) from 2 day file(s) into ${join(dir, EventStoreConstants.FILE)}; 0 already there; 1 line(s) that are not events\n`,
    );
  });
});

describe('doctor events-import', () => {
  test('warns while day files are not loaded, and the command it prints loads them', () => {
    const root = createProject({
      files: {
        '.configs/vulcan.config.mts': 'export default { board: { events: { log: true } } };\n',
        '.agents/local/events/2026-11-03.jsonl': `${lineOf('old')}\n`,
      },
    });
    const first = runCli({ args: ['project', 'doctor'], cwd: root });

    expect(first.stderr).toContain('warning [events-import]');
    expect(first.stderr).toContain('1 day file(s)');
    expect(first.stderr).toContain('run `bun node_modules/.bin/vulcan event import`');

    // What `project sync` writes, which is how the command finds the project.
    mkdirSync(join(root, '.agents/local'), { recursive: true });
    writeFileSync(
      join(root, '.agents/local/vulcan.manifest.json'),
      '{ "project": { "key": "ACME" }, "events": { "log": true } }\n',
    );

    const load = runCli({ args: ['event', 'import'], cwd: root });

    expect(load.stdout + load.stderr).toContain('1 new event(s)');
    expect(summaries(join(root, '.agents/local/events'))).toEqual(['old']);
  });
});

describe('BoardWatch on the database', () => {
  test('the signature changes with a write and not with a read', () => {
    const dir = dirWith({});

    EventLog.append({ dir, event: eventOf('one') });

    const first = BoardWatch.signatureOf({ dir });

    expect(first).not.toBe('');
    EventLog.read({ dir });
    expect(BoardWatch.signatureOf({ dir })).toBe(first);

    EventLog.append({ dir, event: eventOf('two', NOW + 1) });

    expect(BoardWatch.signatureOf({ dir })).not.toBe(first);
  });
});
