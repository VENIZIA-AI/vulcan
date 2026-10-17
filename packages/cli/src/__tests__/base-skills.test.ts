import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_DIRECTORY } from '../common/index.ts';

const SKILLS_DIRECTORY = join(BASE_DIRECTORY, 'skills');

// Every project gets these and cannot shadow them (D2), so none may be written for one project.
test.each(readdirSync(SKILLS_DIRECTORY))('the shipped skill %s names no single project', name => {
  const skill = readFileSync(join(SKILLS_DIRECTORY, name, 'SKILL.md'), 'utf8');

  expect(skill).not.toMatch(/\bIGNIS\b|\bARDOR\b|\bBANA\b|ignis-docs|VENIZIA-AI\/ignis/i);
});
