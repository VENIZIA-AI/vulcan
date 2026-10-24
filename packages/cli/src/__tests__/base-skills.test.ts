import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_DIRECTORY } from '../common/index.ts';
import { lintSkill } from '../doctor/index.ts';
import { triggerOf } from '@venizia/vulcan-atlas';
import { frontmatterOf } from '../skills/index.ts';

const SKILLS_DIRECTORY = join(BASE_DIRECTORY, 'skills');
const PROJECT_NAMES = /\bIGNIS\b|\bARDOR\b|\bBANA\b|ignis-docs|VENIZIA-AI\/ignis/i;

// Every project gets these and cannot shadow them (D2), so none may be written for one project.
test.each(readdirSync(SKILLS_DIRECTORY))('the shipped skill %s names no single project', (name) => {
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
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name));

    expect(files.length).toBeGreaterThan(1);
    expect(files.filter((file) => PROJECT_NAMES.test(readFileSync(file, 'utf8')))).toEqual([]);
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

// Atlas lists each skill with its trigger in the server's instructions, so every skill VULCAN ships must have one.
test('every shipped skill says when to use it, in a "Use when" sentence', () => {
  const names = readdirSync(SKILLS_DIRECTORY);
  const without = names.filter((name) => {
    const { description } = frontmatterOf({
      text: readFileSync(join(SKILLS_DIRECTORY, name, 'SKILL.md'), 'utf8'),
    }).data;

    return !triggerOf({ description: typeof description === 'string' ? description : '' })
      .hasUseWhen;
  });

  expect(names.length).toBeGreaterThan(0);
  expect(without).toEqual([]);
});

describe('the shipped skill docs-writing', () => {
  const body = (): string =>
    readFileSync(join(SKILLS_DIRECTORY, 'docs-writing', 'SKILL.md'), 'utf8')
      .split('\n')
      .slice(0, 25)
      .join('\n');

  test('opens with the rule: be extremely concise, sacrifice grammar for the sake of concision', () => {
    expect(body()).toContain('Be extremely concise. Sacrifice grammar for the sake of concision.');
  });
});

describe('the shipped agent-work skills', () => {
  const NAMES = ['plan-a-change', 'report-back', 'review-a-change', 'fix-a-bug'];
  const read = (name: string, file = 'SKILL.md'): string =>
    readFileSync(join(SKILLS_DIRECTORY, name, file), 'utf8');

  test.each(NAMES)('%s ships, passes the skill lint and is named like its folder', (name) => {
    expect(lintSkill({ directory: join(SKILLS_DIRECTORY, name) })).toEqual([]);
    expect(frontmatterOf({ text: read(name) }).data.name).toBe(name);
  });

  // A description is context every turn pays for: a trigger, short, and a "Use when" part atlas can read.
  test.each(NAMES)('%s has a short description with a "Use when" part', (name) => {
    const description = /^description: (.*)$/m.exec(read(name))?.[1] ?? '';

    expect(description.split(/\s+/).length).toBeLessThanOrEqual(50);
    expect(description).toContain('Use when');
    expect(triggerOf({ description }).text.length).toBeGreaterThan(0);
  });

  test.each(NAMES)('%s has evals with a prompt, an expected output and no project name', (name) => {
    const text = read(name, 'evals/evals.json');
    // The wire names stay behind string-literal access (V-C-14).
    const file: Record<string, unknown> = JSON.parse(text);
    const cases: Record<string, unknown>[] = Array.isArray(file['evals']) ? file['evals'] : [];

    expect(file['skill_name']).toBe(name);
    expect(cases.length).toBeGreaterThanOrEqual(2);
    expect(new Set(cases.map((item) => item['id'])).size).toBe(cases.length);

    for (const item of cases) {
      expect(String(item['prompt']).length).toBeGreaterThan(20);
      expect(String(item['expected_output']).length).toBeGreaterThan(40);
      expect(Array.isArray(item['files'])).toBe(true);
    }

    expect(text).not.toMatch(PROJECT_NAMES);
  });

  test('the skills point at each other by their real names', () => {
    const everything = NAMES.map((name) => read(name)).join('\n');

    for (const reference of [
      ...everything.matchAll(
        /`((?:plan-a-change|report-back|review-a-change|fix-a-bug|build-a-feature|docs-update|docs-writing|knowledge-sync))` skill/g,
      ),
    ]) {
      expect(existsSync(join(SKILLS_DIRECTORY, reference[1], 'SKILL.md'))).toBe(true);
    }
  });

  test('report-back leaves the owner shape to the digest and names the rules it follows', () => {
    const text = read('report-back');

    expect(text).toContain('How to answer the owner');
    expect(text).toContain('V-P-11');
    expect(text).toContain('V-W-06');
    expect(text).not.toMatch(/Blocked:|Decisions needed|Nothing needed yet/);
  });

  test('fix-a-bug builds the loop before any theory', () => {
    const text = read('fix-a-bug');

    expect(text.indexOf('## 1. Build the loop')).toBeLessThan(text.indexOf('## 3. Hypothesise'));
    expect(text).toContain('red-capable');
    expect(text).toContain('regression test');
  });

  test('review-a-change keeps the axes apart and the reviewer read-only', () => {
    const text = read('review-a-change');

    expect(text).toContain('never merged');
    expect(text).toContain('read-only');
    expect(text).toContain('no citation means no finding');
  });

  test('plan-a-change ends on the plan and carries its two references', () => {
    const text = read('plan-a-change');

    expect(text).toContain('A plan ends with the plan');
    expect(existsSync(join(SKILLS_DIRECTORY, 'plan-a-change', 'references', 'spec-card.md'))).toBe(
      true,
    );
    expect(
      existsSync(join(SKILLS_DIRECTORY, 'plan-a-change', 'references', 'design-pass.md')),
    ).toBe(true);
  });
});
