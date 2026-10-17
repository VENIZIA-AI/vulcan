import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import type { ICheckContext } from './checks.ts';
import { DoctorChecks } from './common/index.ts';
import type { IViolation } from './common/index.ts';

/**
 * Anthropic's skill-authoring rules (platform.claude.com, Agent Skills best practices), as checks:
 * the frontmatter limits, SKILL.md under 500 lines, a contents list in any file past 100 lines (an
 * agent may preview only the first lines), references one level deep from SKILL.md, and named
 * requirements for a skill that runs scripts.
 */
const NAME_PATTERN = /^[a-z0-9-]{1,64}$/;
const RESERVED_NAME = /claude|anthropic/;
const XML_TAG = /<\/?[a-zA-Z][^>]*>/;
const MAX_DESCRIPTION = 1024;
const MAX_BODY_LINES = 500;
const CONTENTS_AFTER_LINES = 100;
const CONTENTS_WITHIN_LINES = 30;
const CONTENTS_MARK = /^(\*\*Contents\*\*|#{2,3} Contents|<!-- okf:generated:contents start -->)/;
const MARKDOWN_LINK = /\]\(([^)#\s]+\.md)(?:#[^)]*)?\)/g;
const SCRIPT = /\.(js|mjs|ts|py|sh)$/;
const REQUIREMENTS = /^## (Requirements|Prerequisites)\b/m;
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;

const filesOf = (opts: { directory: string }): string[] =>
  readdirSync(opts.directory).flatMap(name => {
    const path = join(opts.directory, name);

    return statSync(path).isDirectory() ? filesOf({ directory: path }) : [path];
  });

const lineCountOf = (opts: { text: string }): number =>
  opts.text.replace(/\n$/, '').split('\n').length;

const parseYaml = (opts: { text: string }): { value?: unknown; error?: string } => {
  try {
    return { value: Bun.YAML.parse(opts.text) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
};

/**
 * The frontmatter's fields, or why they cannot be read. Bun's YAML error names no line, so the line
 * is the first one at which the block stops parsing - counted in the file, the opening `---` is 1.
 */
const frontmatterOf = (opts: {
  text: string;
}): { data: Record<string, unknown>; error?: string } => {
  const block = FRONTMATTER.exec(opts.text)?.[1];

  if (block === undefined) {
    return { data: {} };
  }

  const parsed = parseYaml({ text: block });

  if (parsed.error !== undefined) {
    const blockLines = block.split('\n');
    const failsAt = blockLines.findIndex(
      (_line, index) =>
        parseYaml({ text: blockLines.slice(0, index + 1).join('\n') }).error !== undefined,
    );
    const where = failsAt === -1 ? '' : ` at line ${failsAt + 2}`;

    return { data: {}, error: `the frontmatter is not valid YAML${where} (${parsed.error})` };
  }

  return {
    data:
      typeof parsed.value === 'object' && parsed.value !== null
        ? Object.fromEntries(Object.entries(parsed.value))
        : {},
  };
};

/** Every rule one skill directory breaks, each a message naming the file. */
export const lintSkill = (opts: { directory: string }): string[] => {
  const skillFile = join(opts.directory, 'SKILL.md');

  if (!existsSync(skillFile)) {
    return ['SKILL.md is missing'];
  }

  const problems: string[] = [];
  const text = readFileSync(skillFile, 'utf8');
  const frontmatter = frontmatterOf({ text });
  const { name, description } = frontmatter.data;

  // One file a project cannot parse is a finding about that file - the other checks still run.
  if (frontmatter.error !== undefined) {
    problems.push(`SKILL.md: ${frontmatter.error}`);
  } else if (typeof name !== 'string' || !NAME_PATTERN.test(name) || RESERVED_NAME.test(name)) {
    problems.push(
      `SKILL.md: name '${String(name)}' - at most 64 characters of a-z, 0-9 and hyphens, never 'claude' or 'anthropic'`,
    );
  }

  if (
    frontmatter.error === undefined &&
    (typeof description !== 'string' ||
      description.trim().length === 0 ||
      description.length > MAX_DESCRIPTION ||
      XML_TAG.test(description))
  ) {
    problems.push('SKILL.md: the description must be 1-1024 characters with no XML tags');
  }

  const body = text.slice(FRONTMATTER.exec(text)?.[0].length ?? 0);
  const bodyLines = lineCountOf({ text: body });

  if (bodyLines >= MAX_BODY_LINES) {
    problems.push(
      `SKILL.md: the body is ${bodyLines} lines - keep it under ${MAX_BODY_LINES}, move detail into reference files`,
    );
  }

  const files = filesOf({ directory: opts.directory }).sort();
  const shown = (path: string): string => relative(opts.directory, path);

  for (const file of files.filter(path => path.endsWith('.md'))) {
    const content = readFileSync(file, 'utf8');
    const count = lineCountOf({ text: content });
    const opening = content.split('\n').slice(0, CONTENTS_WITHIN_LINES);

    if (count > CONTENTS_AFTER_LINES && !opening.some(line => CONTENTS_MARK.test(line))) {
      problems.push(
        `${shown(file)}: ${count} lines and no contents list in its first ${CONTENTS_WITHIN_LINES} lines - an agent may read only the first lines`,
      );
    }

    if (file === skillFile) {
      continue;
    }

    for (const match of content.matchAll(MARKDOWN_LINK)) {
      const target = resolve(dirname(file), match[1]);

      if (target !== skillFile && target.startsWith(`${opts.directory}/`) && existsSync(target)) {
        problems.push(
          `${shown(file)} links ${shown(target)} - link every reference from SKILL.md, one level deep`,
        );
      }
    }
  }

  if (files.some(path => SCRIPT.test(path)) && !REQUIREMENTS.test(text)) {
    problems.push(
      'SKILL.md: the skill runs scripts and has no ## Requirements section - name what they need',
    );
  }

  return problems;
};

/** The project's own skills, linted; a nested one is reported - sync links flat skills only. */
export const checkSkillLint = (opts: ICheckContext): IViolation[] => {
  const skills = join(opts.root, '.agents', 'skills');

  if (!existsSync(skills)) {
    return [];
  }

  return readdirSync(skills)
    .filter(name => statSync(join(skills, name)).isDirectory())
    .sort()
    .flatMap(name => {
      const directory = join(skills, name);
      const file = `.agents/skills/${name}`;

      if (!existsSync(join(directory, 'SKILL.md'))) {
        const inner = readdirSync(directory).find(child =>
          existsSync(join(directory, child, 'SKILL.md')),
        );

        return inner === undefined
          ? []
          : [
              {
                check: DoctorChecks.SKILLS,
                file,
                message: `skills are flat - sync links .agents/skills/<name> only; move ${name}/${inner} up to .agents/skills/${inner}`,
              },
            ];
      }

      return lintSkill({ directory }).map(message => ({
        check: DoctorChecks.SKILLS,
        file,
        message,
      }));
    });
};
