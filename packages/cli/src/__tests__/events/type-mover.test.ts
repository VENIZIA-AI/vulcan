import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EventImport } from '../../events/import.ts';
import { EventLog } from '../../events/log.ts';
import { EventTypeMover } from '../../events/type-mover.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const OLD = '{"id":"a","ts":"2026-11-03T09:30:12.431Z","actor":"x","kind":"commit","summary":"s"}';
const NEW = '{"id":"a","ts":"2026-11-03T09:30:12.431Z","actor":"x","type":"commit","summary":"s"}';

describe('the move of the event lines from kind to type', () => {
  test('a line with a kind that is an event type gets type in the same place', () => {
    expect(EventTypeMover.moveText({ text: `${OLD}\n` })).toBe(`${NEW}\n`);
  });

  test('a line that is not JSON, has a type already or has another kind is left, and a second run changes nothing', () => {
    const text = `not json\n${NEW}\n{"kind":"nothing"}\n${OLD}\n`;
    const first = EventTypeMover.moveText({ text });

    expect(first).toBe(`not json\n${NEW}\n{"kind":"nothing"}\n${NEW}\n`);
    expect(EventTypeMover.moveText({ text: first })).toBe(first);
  });

  test('the day files of the folder are loaded with the new key, other files and a folder that is not there are not', () => {
    const root = createProject({ files: {} });
    const dir = join(root, 'events');
    // A whole event needs a source; the other file holds another one, so that reading it would show.
    const old = OLD.replace('}', ',"source":"cli"}');
    const other = old.replace('"id":"a"', '"id":"b"');

    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '2026-11-03.jsonl'), `${old}\n`);
    writeFileSync(join(dir, 'notes.txt'), `${other}\n`);

    expect(EventImport.run({ dir })).toEqual({ files: 1, added: 1, present: 0, skipped: 0 });
    expect(EventLog.read({ dir }).events.map((event) => [event.id, event.type])).toEqual([
      ['a', 'commit'],
    ]);
    expect(readFileSync(join(dir, '2026-11-03.jsonl'), 'utf8')).toBe(`${old}\n`);
    expect(readFileSync(join(dir, 'notes.txt'), 'utf8')).toBe(`${other}\n`);
    expect(EventImport.run({ dir: join(root, 'absent') })).toEqual({
      files: 0,
      added: 0,
      present: 0,
      skipped: 0,
    });
  });
});
