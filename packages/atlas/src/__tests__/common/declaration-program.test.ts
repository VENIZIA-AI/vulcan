import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeclarationProgram } from '@/common/declaration-program';

const root = mkdtempSync(join(tmpdir(), 'atlas-program-'));

afterAll(() => rmSync(root, { recursive: true, force: true }));

const write = (opts: { name: string; text: string }): string => {
  const file = join(root, opts.name);

  writeFileSync(file, opts.text);

  return file;
};

test('one program serves every entry of a run', () => {
  const first = write({
    name: 'first.d.ts',
    text: 'export declare const a: number;\nexport interface B {}\n',
  });
  const second = write({ name: 'second.d.ts', text: 'export declare function c(): void;\n' });
  const program = DeclarationProgram.create({ files: [first, second], scope: 'test' });

  const namesOf = (opts: { file: string }): string[] => {
    const { checker, moduleSymbol } = program.moduleOf({ file: opts.file });

    return checker
      .getExportsOfModule(moduleSymbol)
      .map((symbol) => symbol.getName())
      .sort();
  };

  expect(namesOf({ file: first })).toEqual(['B', 'a']);
  expect(namesOf({ file: second })).toEqual(['c']);
});

test('a missing entry fails before any parsing, naming the file and the fix', () => {
  expect(() =>
    DeclarationProgram.create({ files: [join(root, 'absent.d.ts')], scope: 'test' }),
  ).toThrow('[test] ' + join(root, 'absent.d.ts') + ' does not exist - build the package first');
});

test('a file that is not a module is reported, never read as empty', () => {
  const script = write({ name: 'script.d.ts', text: 'declare const global: number;\n' });
  const program = DeclarationProgram.create({ files: [script], scope: 'test' });

  expect(() => program.moduleOf({ file: script })).toThrow(`[test] ${script} is not a module`);
});
