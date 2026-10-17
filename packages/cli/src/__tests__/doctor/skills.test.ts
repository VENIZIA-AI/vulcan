import { afterAll, describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_DIRECTORY } from '../../common/index.ts';
import { DoctorChecks, lintSkill, runDoctorChecks } from '../../doctor/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const lines = (opts: { count: number }): string =>
  Array.from({ length: opts.count }, (_unused, index) => `Line ${index + 1}.`).join('\n');

const SKILL = (opts: { name?: string; description?: string; body?: string }): string =>
  `---\nname: ${opts.name ?? 'checking-links'}\ndescription: ${opts.description ?? 'Checks every link in the docs. Use when the user asks to check links.'}\n---\n\n# Checking links\n\n${opts.body ?? 'Run the checker.'}\n`;

const lintOf = (opts: { files: Record<string, string> }): string[] => {
  const root = createProject({ files: opts.files });

  return lintSkill({ directory: join(root, 'skill') });
};

describe('lintSkill', () => {
  test('a short, flat skill with a good name and description passes', () => {
    expect(
      lintOf({ files: { 'skill/SKILL.md': SKILL({}), 'skill/references/a.md': '# A\n' } }),
    ).toEqual([]);
  });

  test('the name and description follow the published rules (positive controls)', () => {
    expect(lintOf({ files: { 'skill/SKILL.md': SKILL({ name: 'Claude_Helper' }) } })).toEqual([
      "SKILL.md: name 'Claude_Helper' - at most 64 characters of a-z, 0-9 and hyphens, never 'claude' or 'anthropic'",
    ]);
    expect(
      lintOf({ files: { 'skill/SKILL.md': SKILL({ description: 'Use <tool> often.' }) } }),
    ).toEqual(['SKILL.md: the description must be 1-1024 characters with no XML tags']);
  });

  test('frontmatter YAML that does not parse is reported with its line, never a crash', () => {
    const broken =
      '---\nname: checking-links\ndescription: Checks links.\nargument-hint: [a] [b]\n---\n\n# Checking links\n';
    const problems = lintOf({ files: { 'skill/SKILL.md': broken } });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toStartWith('SKILL.md: the frontmatter is not valid YAML');
    expect(problems[0]).toContain('line 4');
  });

  test('SKILL.md stays under 500 lines', () => {
    expect(lintOf({ files: { 'skill/SKILL.md': SKILL({ body: lines({ count: 520 }) }) } })).toEqual(
      [
        'SKILL.md: the body is 523 lines - keep it under 500, move detail into reference files',
        'SKILL.md: 527 lines and no contents list in its first 30 lines - an agent may read only the first lines',
      ],
    );
  });

  test('a file over 100 lines opens with a contents list', () => {
    const long = `# Long\n\n${lines({ count: 120 })}\n`;

    expect(
      lintOf({ files: { 'skill/SKILL.md': SKILL({}), 'skill/references/long.md': long } }),
    ).toEqual([
      'references/long.md: 122 lines and no contents list in its first 30 lines - an agent may read only the first lines',
    ]);
    expect(
      lintOf({
        files: {
          'skill/SKILL.md': SKILL({}),
          'skill/references/long.md': long.replace(
            '# Long\n',
            '# Long\n\n**Contents**\n\n- [A](#a)\n',
          ),
        },
      }),
    ).toEqual([]);
  });

  test('references stay one level deep from SKILL.md', () => {
    expect(
      lintOf({
        files: {
          'skill/SKILL.md': SKILL({ body: 'See [a](references/a.md).' }),
          'skill/references/a.md': '# A\n\nSee [b](b.md).\n',
          'skill/references/b.md': '# B\n',
        },
      }),
    ).toEqual([
      'references/a.md links references/b.md - link every reference from SKILL.md, one level deep',
    ]);
  });

  test('a skill that runs scripts lists what they need', () => {
    expect(
      lintOf({ files: { 'skill/SKILL.md': SKILL({}), 'skill/check.ts': 'export {};\n' } }),
    ).toEqual([
      'SKILL.md: the skill runs scripts and has no ## Requirements section - name what they need',
    ]);
    expect(
      lintOf({
        files: {
          'skill/SKILL.md': SKILL({ body: '## Requirements\n\nBun 1.4.' }),
          'skill/check.ts': 'export {};\n',
        },
      }),
    ).toEqual([]);
  });
});

describe('doctor [skills]', () => {
  test('lints every project skill, and a nested skill is reported - sync links flat skills only', async () => {
    const root = createProject({
      files: {
        '.configs/vulcan.config.ts': 'export default {};\n',
        '.agents/skills/checking-links/SKILL.md': SKILL({ name: 'Bad Name' }),
        '.agents/skills/group/inner/SKILL.md': SKILL({}),
      },
    });
    const messages = (await runDoctorChecks({ root }))
      .filter(violation => violation.check === DoctorChecks.SKILLS)
      .map(violation => `${violation.file}: ${violation.message}`);

    expect(messages).toEqual([
      ".agents/skills/checking-links: SKILL.md: name 'Bad Name' - at most 64 characters of a-z, 0-9 and hyphens, never 'claude' or 'anthropic'",
      '.agents/skills/group: skills are flat - sync links .agents/skills/<name> only; move group/inner up to .agents/skills/inner',
    ]);
  });

  test('every skill VULCAN ships passes its own lint', () => {
    const shipped = readdirSync(join(BASE_DIRECTORY, 'skills'));

    expect(shipped.length).toBeGreaterThan(1);
    expect(
      shipped.flatMap(name =>
        lintSkill({ directory: join(BASE_DIRECTORY, 'skills', name) }).map(
          problem => `${name}: ${problem}`,
        ),
      ),
    ).toEqual([]);
  });
});

describe('doctor [skills] - a project skill named like a shipped one', () => {
  test('fails, and suggests a rename the project owns', async () => {
    const root = createProject({
      files: {
        '.configs/vulcan.config.ts': "export default { name: 'shop' };\n",
        '.agents/skills/knowledge-sync/SKILL.md': SKILL({ name: 'knowledge-sync' }),
      },
    });
    const messages = (await runDoctorChecks({ root }))
      .filter(violation => violation.check === DoctorChecks.SKILLS)
      .map(violation => violation.message);

    expect(messages).toContain(
      "'knowledge-sync' is a shipped skill - rename the project skill, for example to 'shop-knowledge-sync'",
    );
  });
});
