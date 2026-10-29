import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_DIRECTORY } from '../common/index.ts';
import { lintSkill } from '../doctor/index.ts';
import { triggerOf } from '@venizia/vulcan-atlas';
import { frontmatterOf } from '../skills/index.ts';
import { VisualizeLimits } from '../visualize/index.ts';

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
    expect(description()).toContain('Load it before you answer');
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
  const NAMES = [
    'plan-a-change',
    'report-back',
    'review-a-change',
    'fix-a-bug',
    'ship',
    'retro',
    'research',
  ];
  const read = (name: string, file = 'SKILL.md'): string =>
    readFileSync(join(SKILLS_DIRECTORY, name, file), 'utf8');

  test.each(NAMES)('%s ships, passes the skill lint and is named like its folder', (name) => {
    expect(lintSkill({ directory: join(SKILLS_DIRECTORY, name) })).toEqual([]);
    expect(frontmatterOf({ text: read(name) }).data.name).toBe(name);
  });

  // A description is context every turn pays for: a trigger, under 700 characters (the routing eval found the
  // moments, the product and a "Skip for" list route better than one sentence), and a "Use when" part atlas can read.
  test.each(NAMES)('%s has a short description with a "Use when" part', (name) => {
    const description = /^description: (.*)$/m.exec(read(name))?.[1] ?? '';

    expect(description.length).toBeLessThanOrEqual(700);
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
        /`((?:plan-a-change|report-back|review-a-change|fix-a-bug|build-a-feature|docs-update|docs-writing|knowledge-sync|visualize-work|ship|retro|research))` skill/g,
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

  test('plan-a-change ends on the plan, carries the spec card and names the shared design pass', () => {
    const text = read('plan-a-change');

    expect(text).toContain('A plan ends with the plan');
    expect(existsSync(join(SKILLS_DIRECTORY, 'plan-a-change', 'references', 'spec-card.md'))).toBe(
      true,
    );
    expect(text).toContain('base/references/design-pass.md');
    expect(existsSync(join(BASE_DIRECTORY, 'references', 'design-pass.md'))).toBe(true);
  });
});

describe('the plan-a-change card names who runs each outward action', () => {
  const directory = join(SKILLS_DIRECTORY, 'plan-a-change');

  test('the card template has a Runs by section for outward actions, and the checklist asks for it', () => {
    const card = readFileSync(join(directory, 'references', 'spec-card.md'), 'utf8');
    const skill = readFileSync(join(directory, 'SKILL.md'), 'utf8');

    expect(card).toContain('| Runs by |');
    expect(card).toContain('a release dispatch');
    expect(card).toContain('the session');
    expect(skill).toContain('who runs each outward action');
  });

  test('an eval holds a plan with outward actions to the Runs by line', () => {
    const evals: { evals: Record<string, unknown>[] } = JSON.parse(
      readFileSync(join(directory, 'evals', 'evals.json'), 'utf8'),
    );

    expect(
      evals.evals.some(
        (entry) =>
          String(entry['prompt']).includes('release') &&
          String(entry['expected_output']).includes('Runs by'),
      ),
    ).toBe(true);
  });
});

describe('the shipped skill visualize-work', () => {
  const directory = join(SKILLS_DIRECTORY, 'visualize-work');
  const skill = (): string => readFileSync(join(directory, 'SKILL.md'), 'utf8');

  test('ships with its spec reference and evals, and lints clean', () => {
    expect(lintSkill({ directory })).toEqual([]);
    expect(existsSync(join(directory, 'references', 'spec.md'))).toBe(true);
    expect(existsSync(join(directory, 'evals', 'evals.json'))).toBe(true);
  });

  test('keeps the page a local file: no publishing, nothing outside .agents/local', () => {
    expect(skill()).toContain('.agents/local/prototypes/');
    expect(skill()).toContain('nothing is published');
    expect(skill()).toContain('not browser-checked');
  });

  test('the command and the skill agree on the limits', () => {
    const reference = readFileSync(join(directory, 'references', 'spec.md'), 'utf8');

    expect(reference).toContain(`${VisualizeLimits.MAX_NODES} boxes`);
    expect(reference).toContain(`${VisualizeLimits.MAX_EDGES} arrows`);
    expect(skill()).toContain(`${VisualizeLimits.FAIL_BYTES / 1024} KB`);
  });
});

describe('the shipped skills ship, retro and research', () => {
  const read = (name: string): string =>
    readFileSync(join(SKILLS_DIRECTORY, name, 'SKILL.md'), 'utf8');

  test('ship asks for the owner words before a shared action and a probe before a public claim', () => {
    const text = read('ship');

    expect(text).toContain("owner's own words");
    expect(text).toContain('public state');
    expect(text).toContain('Not verified');
  });

  test('retro classifies before it proposes and applies nothing without a pick', () => {
    const text = read('retro').replaceAll('\n', ' ');

    expect(text.indexOf('## 3. Classify each finding')).toBeLessThan(
      text.indexOf('## 4. Present, and wait'),
    );
    expect(text).toContain('A finding without a source is dropped');
    expect(text).toContain('Apply nothing');
  });

  test('research is read-only, treats fetched content as untrusted and keeps clones in the project', () => {
    const text = read('research');

    expect(text).toContain('untrusted data');
    expect(text).toContain('Execute nothing');
    expect(text).toContain('.agents/local/clones/');
  });
});

describe('every shipped skill and the shared references', () => {
  const REFERENCES_DIRECTORY = join(BASE_DIRECTORY, 'references');
  const ALL = readdirSync(SKILLS_DIRECTORY);

  // A description is context every turn pays for: under 700 characters. build-a-feature carries one extra
  // sentence, the rule that it is loaded before a workflow question is answered.
  test.each(ALL)('the description of %s is short and has a "Use when" part', (name) => {
    const description =
      /^description: (.*)$/m.exec(
        readFileSync(join(SKILLS_DIRECTORY, name, 'SKILL.md'), 'utf8'),
      )?.[1] ?? '';

    expect(description.length).toBeLessThanOrEqual(700);
    expect(description).toContain('Use when');
  });

  test.each(ALL)('%s lints clean', (name) => {
    expect(lintSkill({ directory: join(SKILLS_DIRECTORY, name) })).toEqual([]);
  });

  const references = readdirSync(REFERENCES_DIRECTORY);

  test('the shared references are the six the skills point at', () => {
    expect([...references].sort()).toEqual([
      'delegation-brief.md',
      'design-pass.md',
      'evidence.md',
      'phase-boundaries.md',
      'testing.md',
      'work-item.md',
    ]);
  });

  test.each(references)(
    '%s names no single project, has a contents list when long, and an H1',
    (name) => {
      const text = readFileSync(join(REFERENCES_DIRECTORY, name), 'utf8');
      const lines = text.split('\n');

      expect(text).not.toMatch(PROJECT_NAMES);
      expect(lines[0]).toMatch(/^# /);

      if (lines.length > 100) {
        expect(lines.slice(0, 30).some((line) => line.startsWith('**Contents**'))).toBe(true);
      }
    },
  );

  // Skills are linked one by one, so a relative link between them would not resolve: they name the shared
  // references by their path under node_modules, and every such path must exist.
  test('every shared reference a skill names exists', () => {
    const texts = ALL.flatMap((name) =>
      readdirSync(join(SKILLS_DIRECTORY, name), { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
        .map((entry) => readFileSync(join(entry.parentPath, entry.name), 'utf8')),
    );
    const named = new Set(
      texts.flatMap((text) =>
        [...text.matchAll(/node_modules\/@venizia\/vulcan\/base\/references\/([\w-]+\.md)/g)].map(
          (match) => match[1],
        ),
      ),
    );

    expect([...named].length).toBeGreaterThanOrEqual(4);

    for (const name of named) {
      expect(references).toContain(name);
    }
  });

  // A reference that nothing names is never loaded, whatever its header says.
  test.each(references)('%s is named by at least one skill or by a base rule', (name) => {
    const texts = [
      readFileSync(join(BASE_DIRECTORY, 'rules.md'), 'utf8'),
      ...ALL.flatMap((skill) =>
        readdirSync(join(SKILLS_DIRECTORY, skill), { recursive: true, withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
          .map((entry) => readFileSync(join(entry.parentPath, entry.name), 'utf8')),
      ),
    ];

    expect(texts.some((text) => text.includes(`base/references/${name}`))).toBe(true);
  });

  test('plan-a-change writes lane L slices as work items and names no files', () => {
    const text = readFileSync(join(SKILLS_DIRECTORY, 'plan-a-change', 'SKILL.md'), 'utf8');

    expect(text).toContain('base/references/work-item.md');
    expect(text).toMatch(/key\s+interfaces/);
    expect(text).not.toContain('one seam, its files');
  });

  test('the work-item reference has the template, the writing rules and the self-check, and shows no local path', () => {
    const text = readFileSync(join(REFERENCES_DIRECTORY, 'work-item.md'), 'utf8');

    for (const part of ['## The template', '## Writing rules', '## The self-check']) {
      expect(text).toContain(part);
    }

    // The nine fixed headings, in order, in the table of the template and in the example.
    const headings = [
      'Category',
      'Summary',
      'Current behaviour',
      'Desired behaviour',
      'Key interfaces',
      'Acceptance criteria',
      'Out of scope',
      'Blocked by',
      'Parent',
    ];
    const example = [...text.matchAll(/^## (.+)$/gm)]
      .map((match) => match[1])
      .filter((heading) => headings.includes(heading ?? ''));

    expect(example).toEqual(headings);
    expect(text).toContain("the project's `owner.language`");

    expect(text).not.toMatch(/(?:^|[\s(])(?:\/home\/|\/Users\/|~\/|[A-Z]:\\)/m);
  });

  test('the brief, the handoff, the pull request and the phase table point at the work item', () => {
    for (const file of [
      join(BASE_DIRECTORY, 'references', 'delegation-brief.md'),
      join(BASE_DIRECTORY, 'references', 'phase-boundaries.md'),
      join(SKILLS_DIRECTORY, 'report-back', 'SKILL.md'),
      join(SKILLS_DIRECTORY, 'ship', 'SKILL.md'),
    ]) {
      expect(readFileSync(file, 'utf8'), file).toMatch(/work[ -]item/);
    }
  });

  test('the delegation brief tells the sender to name the skill the receiver must load, not to retype its steps', () => {
    const text = readFileSync(join(BASE_DIRECTORY, 'references', 'delegation-brief.md'), 'utf8');

    expect(text).toContain('3. **The skill**, when the work matches one');
    expect(text).toContain('tell the receiver to load it');
    expect(text).toContain('Never retype its steps');
    expect(text).toContain('A message to another session is a brief too');
  });

  test('build-a-feature wires the cards, the design pass, the testing reference, the docs and the review', () => {
    const text = readFileSync(join(SKILLS_DIRECTORY, 'build-a-feature', 'SKILL.md'), 'utf8');

    for (const part of [
      '`plan-a-change` skill',
      'references/design-pass.md',
      'references/testing.md',
      '`docs-update` skill',
      '`review-a-change` skill',
      '`report-back` skill',
      'Docs impact',
    ]) {
      expect(text).toContain(part);
    }
  });

  test('docs-update says where it runs in a change, and knowledge-sync that it is periodic', () => {
    expect(readFileSync(join(SKILLS_DIRECTORY, 'docs-update', 'SKILL.md'), 'utf8')).toContain(
      'Where this runs in a change',
    );
    expect(readFileSync(join(SKILLS_DIRECTORY, 'knowledge-sync', 'SKILL.md'), 'utf8')).toContain(
      'periodic audit',
    );
  });

  test('docs-writing carries the agent-documents reference', () => {
    const directory = join(SKILLS_DIRECTORY, 'docs-writing');

    expect(existsSync(join(directory, 'references', 'agent-documents.md'))).toBe(true);
    expect(readFileSync(join(directory, 'SKILL.md'), 'utf8')).toContain(
      'references/agent-documents.md',
    );
  });
});

describe('the shipped skill ship', () => {
  const skill = readFileSync(join(SKILLS_DIRECTORY, 'ship', 'SKILL.md'), 'utf8');

  test('opens a pull request with its base named', () => {
    expect(skill).toContain('gh pr create --base <branch>');
  });

  test('never says a pull request closes its issue without naming the default branch', () => {
    const unconditional = skill
      .split(/\n\s*\n/)
      .filter((paragraph) => /\bcloses\b/i.test(paragraph) && !/default branch/i.test(paragraph));

    expect(unconditional).toEqual([]);
  });
});
