import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { BASE_DIRECTORY } from '../common/index.ts';
import { frontmatterOf } from '../skills/index.ts';

const RULE_ID = /\bV-[A-Z]-\d\d\b/g;
const TEXT_FILE = /\.(md|json|ts|mk)$/;

const filesUnder = (opts: { directory: string }): string[] =>
  readdirSync(opts.directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && TEXT_FILE.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));

const rulesText = readFileSync(join(BASE_DIRECTORY, 'rules.md'), 'utf8');
const definedRules = new Set(
  [...rulesText.matchAll(/^\| (V-[A-Z]-\d\d) \|/gm)].map((match) => match[1]),
);

describe('the base text agrees with the base rules', () => {
  test('the rules table defines each id once', () => {
    const rows = [...rulesText.matchAll(/^\| (V-[A-Z]-\d\d) \|/gm)].map((match) => match[1]);

    expect(rows.length).toBeGreaterThan(40);
    expect(new Set(rows).size).toBe(rows.length);
  });

  // A skill, a reference or a hook that cites a rule that does not exist sends the agent to nothing.
  test('every rule id cited anywhere under base/ is defined', () => {
    const cited: string[] = [];

    for (const file of filesUnder({ directory: BASE_DIRECTORY })) {
      // The rules file also lists, on purpose, the ids it does not carry: a bullet that opens with one.
      const text = readFileSync(file, 'utf8').replace(/^- `V-[A-Z]-\d\d`.*$/gm, '');

      for (const match of text.matchAll(RULE_ID)) {
        if (!definedRules.has(match[0])) {
          cited.push(`${relative(BASE_DIRECTORY, file)}: ${match[0]}`);
        }
      }
    }

    expect(cited).toEqual([]);
  });

  test('every skill has frontmatter that parses, a name equal to its folder and a description', () => {
    const skillsDirectory = join(BASE_DIRECTORY, 'skills');

    for (const name of readdirSync(skillsDirectory)) {
      const { data } = frontmatterOf({
        text: readFileSync(join(skillsDirectory, name, 'SKILL.md'), 'utf8'),
      });

      expect(data.name, name).toBe(name);
      expect(typeof data.description === 'string' && data.description.length > 20, name).toBe(true);
    }
  });

  // Rules and references are read on every session or on demand: they have a size, and growth is a decision.
  test('the budgets hold: the rules, each shared reference and each skill body stay small', () => {
    expect(rulesText.split(/\s+/).length).toBeLessThan(4000);

    const references = join(BASE_DIRECTORY, 'references');

    for (const name of readdirSync(references)) {
      expect(readFileSync(join(references, name), 'utf8').split('\n').length, name).toBeLessThan(
        250,
      );
    }

    const skills = join(BASE_DIRECTORY, 'skills');

    for (const name of readdirSync(skills)) {
      const path = join(skills, name, 'SKILL.md');

      expect(statSync(path).size, name).toBeLessThan(24 * 1024);
    }
  });
});
