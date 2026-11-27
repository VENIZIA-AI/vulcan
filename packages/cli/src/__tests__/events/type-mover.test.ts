import { afterAll, describe, expect, test } from 'bun:test';
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EventTypeMover } from '../../events/type-mover.ts';
import { createProject, removeProjects } from '../helpers/project.helper.ts';

afterAll(removeProjects);

const OLD = '{"id":"a","ts":"2026-11-03T09:30:12.431Z","actor":"x","kind":"commit","summary":"s"}';
const NEW = '{"id":"a","ts":"2026-11-03T09:30:12.431Z","actor":"x","type":"commit","summary":"s"}';

describe('the move of the event lines from kind to type', () => {
  test('a line with a kind that is an event type gets type in the same place', () => {
    const result = EventTypeMover.moveText({ text: `${OLD}\n` });

    expect(result).toEqual({ text: `${NEW}\n`, moved: 1, left: 0 });
  });

  test('a line that is not JSON, has a type already or has another kind is left, and a second run changes nothing', () => {
    const text = `not json\n${NEW}\n{"kind":"nothing"}\n${OLD}\n`;
    const first = EventTypeMover.moveText({ text });

    expect(first.moved).toBe(1);
    expect(first.left).toBe(1);
    expect(first.text).toBe(`not json\n${NEW}\n{"kind":"nothing"}\n${NEW}\n`);
    expect(EventTypeMover.moveText({ text: first.text }).moved).toBe(0);
  });

  test('a line appended after the plan is moved too, and no temporary file is left', () => {
    const root = createProject({ files: {} });
    const dir = join(root, 'events');
    const file = join(dir, '2026-11-04.jsonl');

    mkdirSync(dir, { recursive: true });
    writeFileSync(file, `${OLD}\n`);

    const moves = EventTypeMover.plan({ dir });

    appendFileSync(file, `${OLD}\n`);
    EventTypeMover.apply({ moves });

    expect(readFileSync(file, 'utf8')).toBe(`${NEW}\n${NEW}\n`);
    expect(readdirSync(dir)).toEqual(['2026-11-04.jsonl']);
  });

  test('the day files of the folder are moved, other files and a folder that is not there are not', () => {
    const root = createProject({ files: {} });
    const dir = join(root, 'events');

    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '2026-11-03.jsonl'), `${OLD}\n`);
    writeFileSync(join(dir, 'notes.txt'), `${OLD}\n`);

    const moves = EventTypeMover.plan({ dir });

    expect(moves.map((move) => move.path)).toEqual([join(dir, '2026-11-03.jsonl')]);
    EventTypeMover.apply({ moves });
    expect(readFileSync(join(dir, '2026-11-03.jsonl'), 'utf8')).toBe(`${NEW}\n`);
    expect(readFileSync(join(dir, 'notes.txt'), 'utf8')).toBe(`${OLD}\n`);
    expect(EventTypeMover.plan({ dir })).toEqual([]);
    expect(EventTypeMover.plan({ dir: join(root, 'absent') })).toEqual([]);
  });
});
