import { describe, expect, test } from 'bun:test';
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLine, resolveNames } from '../../create/names.ts';
import type { INameField, TAsk } from '../../create/index.ts';

const FIELDS: INameField[] = [
  { key: 'project', flag: '--project', question: 'Project name (the monorepo folder)' },
  { key: 'backend', flag: '--backend-dir', question: 'Backend folder (holds every backend app)' },
  {
    key: 'shared',
    flag: '--shared-dir',
    question: 'Shared code folder (empty to skip)',
    optional: true,
  },
];

const scripted = (answers: (string | null)[]): TAsk => {
  const queue = [...answers];

  return () => queue.shift() ?? null;
};

describe('resolveNames', () => {
  test('flags fill every name without asking', () => {
    const result = resolveNames({
      fields: FIELDS,
      args: ['--project', 'my-product', '--backend-dir', 'services', '--shared-dir', 'libs'],
      interactive: false,
      ask: scripted([]),
    });

    expect(result).toEqual({
      ok: true,
      names: { project: 'my-product', backend: 'services', shared: 'libs' },
    });
  });

  test('without a TTY a missing flag is an error naming it', () => {
    const result = resolveNames({
      fields: FIELDS,
      args: ['--project', 'my-product'],
      interactive: false,
      ask: scripted([]),
    });

    expect(result).toEqual({
      ok: false,
      error:
        'missing --backend-dir (Backend folder (holds every backend app)) - names are never chosen for you',
    });
  });

  test('without a TTY an optional name may be absent', () => {
    const result = resolveNames({
      fields: FIELDS,
      args: ['--project', 'p', '--backend-dir', 'b'],
      interactive: false,
      ask: scripted([]),
    });

    expect(result).toEqual({ ok: true, names: { project: 'p', backend: 'b', shared: '' } });
  });

  test('in a TTY an invalid answer is asked again, an empty required answer too', () => {
    const result = resolveNames({
      fields: FIELDS,
      args: [],
      interactive: true,
      ask: scripted(['My Product', '', 'my-product', 'services', '']),
    });

    expect(result).toEqual({
      ok: true,
      names: { project: 'my-product', backend: 'services', shared: '' },
    });
  });

  test('an invalid flag value is an error', () => {
    const result = resolveNames({
      fields: FIELDS,
      args: ['--project', '-x', '--backend-dir', 'b'],
      interactive: false,
      ask: scripted([]),
    });

    expect(result.ok).toBe(false);
  });

  test('a previous folder is offered and an empty answer keeps it', () => {
    const fields: INameField[] = [
      { key: 'backend', flag: '--backend-dir', question: 'Backend folder', previous: 'services' },
    ];

    expect(resolveNames({ fields, args: [], interactive: true, ask: scripted(['']) })).toEqual({
      ok: true,
      names: { backend: 'services' },
    });
  });

  test('closing the prompt (null) aborts', () => {
    expect(
      resolveNames({ fields: FIELDS, args: [], interactive: true, ask: scripted([null]) }),
    ).toEqual({ ok: false, error: 'aborted' });
  });
});

describe('readLine', () => {
  const withInput = (opts: { content: string; run: (descriptor: number) => void }): void => {
    const folder = mkdtempSync(join(tmpdir(), 'vulcan-readline-'));
    const file = join(folder, 'input');

    writeFileSync(file, opts.content);

    const descriptor = openSync(file, 'r');

    try {
      opts.run(descriptor);
    } finally {
      closeSync(descriptor);
      rmSync(folder, { recursive: true, force: true });
    }
  };

  test('a bare newline is the empty string, not an abort', () => {
    withInput({ content: '\n', run: descriptor => expect(readLine({ descriptor })).toBe('') });
  });

  test('a text line is returned without its newline', () => {
    withInput({
      content: 'services\n',
      run: descriptor => expect(readLine({ descriptor })).toBe('services'),
    });
  });

  test('a trailing carriage return is stripped', () => {
    withInput({
      content: 'services\r\n',
      run: descriptor => expect(readLine({ descriptor })).toBe('services'),
    });
    withInput({ content: '\r\n', run: descriptor => expect(readLine({ descriptor })).toBe('') });
  });

  test('end of input with nothing read is null, the abort', () => {
    withInput({ content: '', run: descriptor => expect(readLine({ descriptor })).toBeNull() });
  });

  test('a line then end of input: the line, then null', () => {
    withInput({
      content: 'libs\n',
      run: descriptor => {
        expect(readLine({ descriptor })).toBe('libs');
        expect(readLine({ descriptor })).toBeNull();
      },
    });
  });

  test('lines are read one at a time and an empty one between them stays empty', () => {
    withInput({
      content: 'a\n\nb\n',
      run: descriptor => {
        expect(readLine({ descriptor })).toBe('a');
        expect(readLine({ descriptor })).toBe('');
        expect(readLine({ descriptor })).toBe('b');
        expect(readLine({ descriptor })).toBeNull();
      },
    });
  });

  test('text before end of input without a newline is still an answer', () => {
    withInput({
      content: 'tail',
      run: descriptor => {
        expect(readLine({ descriptor })).toBe('tail');
        expect(readLine({ descriptor })).toBeNull();
      },
    });
  });

  test('multi-byte characters survive the byte-wise read', () => {
    withInput({
      content: 'caf\u00e9\n',
      run: descriptor => expect(readLine({ descriptor })).toBe('caf\u00e9'),
    });
  });
});
