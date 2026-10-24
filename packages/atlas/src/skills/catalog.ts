import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { splitFrontmatter } from '@/changelogs/resolve';

const SKILL_FILE = 'SKILL.md';
const SHIPPED_DIRECTORY = join('node_modules', '@venizia', 'vulcan', 'base', 'skills');
const PROJECT_DIRECTORY = join('.agents', 'skills');
const USE_WHEN = /\bUse when\s+/i;
const FALLBACK_MAX = 160;

/** What a skill is for: the "Use when" sentence of its description, else its first sentence. */
export const triggerOf = (opts: { description: string }): { text: string; hasUseWhen: boolean } => {
  const description = opts.description.trim().replace(/\s+/g, ' ');
  const found = USE_WHEN.exec(description);
  const sentenceOf = (text: string): string => {
    const end = text.search(/\.(\s|$)/);

    return (end === -1 ? text : text.slice(0, end)).trim();
  };

  if (found === null) {
    return { text: sentenceOf(description).slice(0, FALLBACK_MAX), hasUseWhen: false };
  }

  return { text: sentenceOf(description.slice(found.index + found[0].length)), hasUseWhen: true };
};

export interface ISkillEntry {
  name: string;
  source: 'shipped' | 'project';
  /** The description's own words; empty when the frontmatter cannot be read. */
  description: string;
}

const namesIn = (opts: { directory: string }): string[] =>
  existsSync(opts.directory)
    ? readdirSync(opts.directory, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isDirectory() && existsSync(join(opts.directory, entry.name, SKILL_FILE)),
        )
        .map((entry) => entry.name)
        .sort()
    : [];

const descriptionOf = (opts: { directory: string; name: string }): string => {
  try {
    const { description } = splitFrontmatter(
      readFileSync(join(opts.directory, opts.name, SKILL_FILE), 'utf8'),
    ).data;

    return typeof description === 'string' ? description : '';
  } catch {
    return '';
  }
};

/**
 * The skills a project has, the set `vulcan sync` links: the shipped ones of the installed vulcan,
 * then the project's own in `.agents/skills`, a project skill that shadows a shipped name left out.
 * Read from disk on every call, so an added, renamed or deleted skill needs no edit anywhere else.
 */
export const skillCatalogOf = (opts: { root: string }): ISkillEntry[] => {
  const shippedDirectory = join(opts.root, SHIPPED_DIRECTORY);
  const projectDirectory = join(opts.root, PROJECT_DIRECTORY);
  const shipped = namesIn({ directory: shippedDirectory });
  const taken = new Set(shipped);

  return [
    ...shipped.map((name): ISkillEntry => ({
      name,
      source: 'shipped',
      description: descriptionOf({ directory: shippedDirectory, name }),
    })),
    ...namesIn({ directory: projectDirectory })
      .filter((name) => !taken.has(name))
      .map((name): ISkillEntry => ({
        name,
        source: 'project',
        description: descriptionOf({ directory: projectDirectory, name }),
      })),
  ].sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
};
