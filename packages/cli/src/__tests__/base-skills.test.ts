import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_DIRECTORY } from '../common/index.ts';
import { lintSkill } from '../doctor/index.ts';

const SKILLS_DIRECTORY = join(BASE_DIRECTORY, 'skills');
const PROJECT_NAMES = /\bIGNIS\b|\bARDOR\b|\bBANA\b|ignis-docs|VENIZIA-AI\/ignis/i;

// Every project gets these and cannot shadow them (D2), so none may be written for one project.
test.each(readdirSync(SKILLS_DIRECTORY))('the shipped skill %s names no single project', name => {
  const skill = readFileSync(join(SKILLS_DIRECTORY, name, 'SKILL.md'), 'utf8');

  expect(skill).not.toMatch(PROJECT_NAMES);
});

describe('the shipped skill docs-update', () => {
  const directory = join(SKILLS_DIRECTORY, 'docs-update');

  test('ships, and passes the skill lint', () => {
    expect(existsSync(join(directory, 'SKILL.md'))).toBe(true);
    expect(lintSkill({ directory })).toEqual([]);
  });

  test('names no project in any file, its evals included - they run against any project', () => {
    const files = readdirSync(directory, { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(entry => join(entry.parentPath, entry.name));

    expect(files.length).toBeGreaterThan(1);
    expect(files.filter(file => PROJECT_NAMES.test(readFileSync(file, 'utf8')))).toEqual([]);
  });

  test('reads its paths from the manifest, never a fixed layout', () => {
    const skill = readFileSync(join(directory, 'SKILL.md'), 'utf8');

    for (const key of ['knowledge.wiki', 'knowledge.changelogs', 'packages[].path']) {
      expect(skill).toContain(key);
    }

    expect(skill).not.toContain('docs/wiki/content');
  });
});

describe('the shipped skill build-a-feature', () => {
  const description = (): string => {
    const text = readFileSync(join(SKILLS_DIRECTORY, 'build-a-feature', 'SKILL.md'), 'utf8');

    return /^description: (.*)$/m.exec(text)?.[1] ?? '';
  };

  // The grounding rule is in the skill's body, which an agent that answers from the description never reads.
  test('its description says to load it before answering, a workflow question included', () => {
    expect(description()).toContain('Load it before you answer any of these');
    expect(description()).toContain('a question about the workflow included');
    expect(description()).toContain('lookup in atlas');
  });
});
