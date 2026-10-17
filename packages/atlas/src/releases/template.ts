/** `[#<issue>] ` at the front of a template: optional on a commit, and a commit may carry several. */
const LEADING_ISSUE = '[#<issue>] ';
const PLACEHOLDER_PATTERN = /<(dir|package|version|issue)>/;

const escapeLiteral = (opts: { text: string }): string =>
  opts.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A release template (`atlas.releaseCommit`) as the pattern that reads a commit subject: named groups
 * `dir` (`<dir>` or its synonym `<package>`), `version` and `issue`. Every other character is literal;
 * a trailing ` [<mode>]` is tolerated. A template with no `<dir>` is a release train's: its commit
 * releases every live package.
 */
export const compileReleaseTemplate = (opts: { template: string }): RegExp => {
  const leading = opts.template.startsWith(LEADING_ISSUE);
  const rest = leading ? opts.template.slice(LEADING_ISSUE.length) : opts.template;
  const named = new Set<string>();

  // `split` with a capture group alternates literal text and placeholder names.
  const body = rest
    .split(PLACEHOLDER_PATTERN)
    .map((part, index) => {
      if (index % 2 === 0) {
        return escapeLiteral({ text: part });
      }

      const group = part === 'package' ? 'dir' : part;
      const pattern = { dir: '[a-z0-9][a-z0-9.-]*', version: '\\S+', issue: '\\d+' }[group] ?? '';

      if (named.has(group)) {
        return `\\k<${group}>`;
      }

      named.add(group);

      return `(?<${group}>${pattern})`;
    })
    .join('');

  return new RegExp(`^${leading ? '(?:\\[#\\d+\\])*\\s*' : ''}${body}(?: \\[[a-z]+\\])?$`);
};
