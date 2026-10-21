import { afterAll, describe, expect, test } from 'bun:test';
import { runDoctorWarnings } from '../../doctor/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const CONFIG = "export default { name: 'acme', rules: { 'V-W-01': 'read-only' } };\n";
const skill = (opts: { name: string; description: string }): string =>
  `---\nname: ${opts.name}\ndescription: ${opts.description}\n---\n\n# ${opts.name}\n`;
const project = (opts: { description: string }) =>
  createProject({
    files: {
      '.configs/vulcan.config.ts': CONFIG,
      '.agents/skills/acme-odd/SKILL.md': skill({
        name: 'acme-odd',
        description: opts.description,
      }),
    },
  });

describe('doctor warns about a skill with no "Use when" part', () => {
  test('a warning on the skill file, saying atlas cannot tell when to load it', async () => {
    const warnings = await runDoctorWarnings({
      root: project({ description: 'Does an odd thing.' }),
    });

    expect(warnings).toEqual([
      {
        check: 'skills',
        file: '.agents/skills/acme-odd/SKILL.md',
        message:
          '\'acme-odd\' has no "Use when" part in its description - atlas cannot say when to load it',
      },
    ]);
  });

  test('a skill with one is not named', async () => {
    const warnings = await runDoctorWarnings({
      root: project({ description: 'Does an odd thing. Use when the user asks for odd things.' }),
    });

    expect(warnings).toEqual([]);
  });
});
